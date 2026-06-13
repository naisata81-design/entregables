const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// Tu Token de Flespi extraído de server.js
const FLESPI_TOKEN = '933gcAbczGluPERbGkm0ktw72AEA829Jnf1pEEhO8dFjRtJXRfoY2ejMgNkxafb6';
const MONGODB_URI = 'mongodb+srv://naisata:Hola2025@naisata.kwletg6.mongodb.net/naisata_db?appName=naisata';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Servidor Respaldo conectado a MongoDB'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

// --- Schemas ligeros (apuntan a las mismas colecciones del servidor principal) ---

const VehicleSchema = new mongoose.Schema({
    marca: String,
    modelo: String,
    placas: String,
    color: String,
    estado: String,
    flespiId: String,
    encendido: Boolean,
    currentUserId: String,
    currentUserName: String
}, { collection: 'vehicles' });
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

const VehicleTransactionSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    vehicleId: String,
    userId: String,
    userName: String,
    tipoMovimiento: String,
    notas: String,
    estadoConfirmacion: { type: String, default: 'Confirmado' },
    fecha: { type: Date, default: Date.now }
}, { collection: 'vehicletransactions' });
const VehicleTransaction = mongoose.model('VehicleTransaction', VehicleTransactionSchema);

const UserSchema = new mongoose.Schema({
    nombre: String,
    apellido: String,
    estadoCuenta: String
}, { collection: 'users' });
const User = mongoose.model('User', UserSchema);

app.get('/', (req, res) => {
    res.send('Servidor de Respaldo Naisata (Render) Activo 🟢');
});

// Obtener lista de vehículos
app.get('/api/sos/vehicles', async (req, res) => {
    try {
        const vehicles = await Vehicle.find({ flespiId: { $ne: null, $ne: '' } }).select('marca modelo placas flespiId encendido');
        res.json(vehicles);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando base de datos' });
    }
});

// Obtener lista completa de vehículos para gestión
app.get('/api/sos/vehicles/all', async (req, res) => {
    try {
        const vehicles = await Vehicle.find().select('marca modelo placas flespiId encendido estado currentUserName');
        res.json(vehicles);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando base de datos' });
    }
});

// Obtener lista de usuarios para préstamo
app.get('/api/sos/users', async (req, res) => {
    try {
        const users = await User.find({ estadoCuenta: { $in: ['activa'] } }).select('nombre apellido').sort({ nombre: 1 });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Error consultando base de datos' });
    }
});

// Registrar préstamo en modo emergencia
app.post('/api/sos/vehicles/loan', async (req, res) => {
    const { vehicleId, userId, userName, notas } = req.body;
    if (!vehicleId || !userId || !userName) return res.status(400).json({ error: 'Datos incompletos' });
    
    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle || vehicle.estado !== 'Disponible') return res.status(400).json({ error: 'Vehículo no disponible' });

        vehicle.estado = 'Prestado'; // Lo marcamos directo como prestado
        vehicle.currentUserId = userId;
        vehicle.currentUserName = userName;
        await vehicle.save();

        await VehicleTransaction.create({
            vehicleId,
            userId,
            userName,
            tipoMovimiento: 'Préstamo',
            notas: `[MODO RESPALDO] ${notas || ''}`,
            estadoConfirmacion: 'Confirmado'
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[SOS Loan]', e);
        res.status(500).json({ error: 'Error interno guardando préstamo' });
    }
});

// Registrar devolución en modo emergencia
app.post('/api/sos/vehicles/return', async (req, res) => {
    const { vehicleId, notas } = req.body;
    if (!vehicleId) return res.status(400).json({ error: 'ID de vehículo requerido' });

    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado' });

        vehicle.estado = 'Disponible';
        vehicle.currentUserId = null;
        vehicle.currentUserName = null;
        await vehicle.save();

        await VehicleTransaction.create({
            vehicleId,
            tipoMovimiento: 'Devolución',
            notas: `[MODO RESPALDO] ${notas || ''}`,
            estadoConfirmacion: 'Confirmado'
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[SOS Return]', e);
        res.status(500).json({ error: 'Error interno guardando devolución' });
    }
});

// Ruta de Emergencia SOS (Flespi)
app.post('/api/sos/engine', async (req, res) => {
    const { identifier, action } = req.body;
    
    if (!identifier || !['on', 'off'].includes(action)) {
        return res.status(400).json({ error: 'Datos inválidos' });
    }

    try {
        const cleanId = String(identifier).trim();
        const cmdText = action === 'off' ? 'setdigout 1' : 'setdigout 0';
        
        const payload = [{
            "name": "custom",
            "max_attempts": 3,
            "priority": 0,
            "properties": {
                "text": cmdText
            }
        }];

        const response = await fetch(`https://flespi.io/gw/devices/${cleanId}/commands-queue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `FlespiToken ${FLESPI_TOKEN}`,
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`[SOS] Comando ${action} enviado a unidad ${cleanId}.`);
            await Vehicle.updateOne({ flespiId: cleanId }, { encendido: (action === 'on') }); // Actualiza la BD también
            res.json({ success: true, flespiResponse: data });
        } else {
            console.error('[SOS] Error Flespi:', data);
            res.status(500).json({ error: 'Rechazo de Flespi', details: data });
        }
    } catch (e) {
        console.error('[SOS] Excepción:', e);
        res.status(500).json({ error: 'Error interno en Render', message: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de Respaldo ejecutándose en el puerto ${PORT}`);
});
