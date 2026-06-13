const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

const FLESPI_TOKEN = '933gcAbczGluPERbGkm0ktw72AEA829Jnf1pEEhO8dFjRtJXRfoY2ejMgNkxafb6';
const MONGODB_URI = 'mongodb+srv://naisata:Hola2025@naisata.kwletg6.mongodb.net/naisata_db?appName=naisata';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Servidor Respaldo conectado a MongoDB'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

// ── Schemas compatibles con server.js (mismas colecciones) ──────────────────

const VehicleSchema = new mongoose.Schema({
    marca: String,
    modelo: String,
    placas: String,
    color: String,
    estado: { type: String, default: 'Disponible' },
    flespiId: String,
    encendido: { type: Boolean, default: true },
    currentUserId: { type: String, default: null },
    currentUserName: { type: String, default: null }
}, { collection: 'vehicles' });
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

// Schema compatible con server.js — usa String _id y los mismos campos clave
const VehicleTransactionSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    vehicleId: { type: String, required: true },
    userId: { type: String, default: '' },
    userName: { type: String, default: '' },
    tipoMovimiento: { type: String, required: true },
    notas: { type: String, default: '' },
    estadoConfirmacion: { type: String, default: 'Confirmado' },
    fecha: { type: Date, default: Date.now },
    fechaAceptacion: { type: Date, default: null }
}, { collection: 'vehicletransactions' });
const VehicleTransaction = mongoose.model('VehicleTransaction', VehicleTransactionSchema);

const UserSchema = new mongoose.Schema({
    _id: { type: String },
    nombre: String,
    apellido: String,
    estadoCuenta: String
}, { collection: 'users' });
const User = mongoose.model('User', UserSchema);

// ── Rutas ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.send('Servidor de Respaldo Naisata (Render) Activo 🟢');
});

// Vehículos con GPS para el panel de Flespi
app.get('/api/sos/vehicles', async (req, res) => {
    try {
        const vehicles = await Vehicle.find({ flespiId: { $exists: true, $ne: '' } })
            .select('marca modelo placas flespiId encendido estado currentUserName')
            .lean();
        res.json(vehicles);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando base de datos' });
    }
});

// TODOS los vehículos — con _id y currentUserId para gestión de préstamos
app.get('/api/sos/vehicles/all', async (req, res) => {
    try {
        const vehicles = await Vehicle.find()
            .select('_id marca modelo placas flespiId encendido estado currentUserId currentUserName')
            .lean();
        res.json(vehicles);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando base de datos' });
    }
});

// Usuarios activos para asignar
app.get('/api/sos/users', async (req, res) => {
    try {
        const users = await User.find({ estadoCuenta: 'activa' })
            .select('_id nombre apellido')
            .sort({ nombre: 1 })
            .lean();
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando usuarios' });
    }
});

// ── ASIGNAR VEHÍCULO (Modo Respaldo) ────────────────────────────────────────
// Pone el vehículo en estado 'Prestado' (ya confirmado por admin de emergencia)
// y registra la transacción para que el servidor local lo vea al arrancar.
app.post('/api/sos/vehicles/loan', async (req, res) => {
    const { vehicleId, userId, userName, notas } = req.body;
    if (!vehicleId || !userName) {
        return res.status(400).json({ error: 'Datos incompletos: vehicleId y userName son obligatorios' });
    }

    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado' });
        if (vehicle.estado !== 'Disponible') {
            return res.status(400).json({ error: `El vehículo no está disponible (estado actual: ${vehicle.estado})` });
        }

        // Actualizar vehículo — 'Prestado' directo (respaldo no requiere confirmación WA)
        await Vehicle.findByIdAndUpdate(vehicleId, {
            $set: {
                estado: 'Prestado',
                currentUserId: userId || 'SOS',
                currentUserName: userName,
                encendido: true  // Motor liberado en modo respaldo
            }
        });

        // Crear transacción compatible con el schema de server.js
        await VehicleTransaction.create({
            vehicleId: vehicleId.toString(),
            userId: userId || 'SOS',
            userName,
            tipoMovimiento: 'Préstamo',
            notas: `[MODO RESPALDO] ${notas || ''}`.trim(),
            estadoConfirmacion: 'Confirmado',  // Ya confirmado por admin
            fechaAceptacion: new Date()
        });

        console.log(`[SOS LOAN] Vehículo ${vehicleId} asignado a ${userName}`);
        res.json({ success: true, message: `Vehículo asignado a ${userName} correctamente.` });
    } catch (e) {
        console.error('[SOS Loan]', e);
        res.status(500).json({ error: 'Error interno guardando préstamo: ' + e.message });
    }
});

// ── DEVOLVER VEHÍCULO (Modo Respaldo) ───────────────────────────────────────
app.post('/api/sos/vehicles/return', async (req, res) => {
    const { vehicleId, notas } = req.body;
    if (!vehicleId) return res.status(400).json({ error: 'ID de vehículo requerido' });

    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado' });

        const previousUserName = vehicle.currentUserName || 'N/A';

        // Regresar a Disponible y limpiar asignación
        await Vehicle.findByIdAndUpdate(vehicleId, {
            $set: {
                estado: 'Disponible',
                currentUserId: null,
                currentUserName: null,
                encendido: true  // Motor liberado al devolver
            }
        });

        await VehicleTransaction.create({
            vehicleId: vehicleId.toString(),
            userId: 'SOS',
            userName: previousUserName,
            tipoMovimiento: 'Devolución',
            notas: `[MODO RESPALDO] ${notas || ''}`.trim(),
            estadoConfirmacion: 'Confirmado'
        });

        console.log(`[SOS RETURN] Vehículo ${vehicleId} devuelto por ${previousUserName}`);
        res.json({ success: true, message: `Devolución de ${previousUserName} registrada correctamente.` });
    } catch (e) {
        console.error('[SOS Return]', e);
        res.status(500).json({ error: 'Error interno guardando devolución: ' + e.message });
    }
});

// ── CONTROL GPS FLESPI ───────────────────────────────────────────────────────
app.post('/api/sos/engine', async (req, res) => {
    const { identifier, action } = req.body;

    if (!identifier || !['on', 'off'].includes(action)) {
        return res.status(400).json({ error: 'Datos inválidos: identifier y action(on|off) requeridos' });
    }

    try {
        const cleanId = String(identifier).trim();
        const cmdText = action === 'off' ? 'setdigout 1' : 'setdigout 0';

        const payload = [{
            name: 'custom',
            max_attempts: 3,
            priority: 0,
            properties: { text: cmdText }
        }];

        const response = await fetch(`https://flespi.io/gw/devices/${cleanId}/commands-queue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `FlespiToken ${FLESPI_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            // Actualizar estado en BD
            await Vehicle.updateOne({ flespiId: cleanId }, { $set: { encendido: action === 'on' } });
            console.log(`[SOS ENGINE] ${action} → unidad ${cleanId}`);
            res.json({ success: true, flespiResponse: data });
        } else {
            console.error('[SOS] Error Flespi:', data);
            res.status(500).json({ error: 'Rechazo de Flespi', details: data });
        }
    } catch (e) {
        console.error('[SOS ENGINE] Excepción:', e);
        res.status(500).json({ error: 'Error interno en Render', message: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🟢 Servidor de Respaldo Naisata ejecutándose en puerto ${PORT}`);
});
