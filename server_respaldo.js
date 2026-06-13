const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// Tu Token de Flespi extraído de server.js
const FLESPI_TOKEN = '933gcAbczGluPERbGkm0ktw72AEA829Jnf1pEEhO8dFjRtJXRfoY2ejMgNkxafb6';
const MONGODB_URI = 'mongodb+srv://naisata:Hola2025@naisata.kwletg6.mongodb.net/naisata_db?appName=naisata';

app.use(cors({ origin: '*' }));
app.use(express.json());

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Servidor Respaldo conectado a MongoDB'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

const VehicleSchema = new mongoose.Schema({
    marca: String,
    modelo: String,
    placas: String,
    flespiId: String,
    encendido: Boolean
}, { collection: 'vehicles' });
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

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

// Ruta de Emergencia SOS
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
