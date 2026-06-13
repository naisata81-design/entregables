const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Tu Token de Flespi
const FLESPI_TOKEN = process.env.FLESPI_TOKEN || '933gcAbczGluPERbGkm0ktw72AEA829Jnf1pEEhO8dFjRtJXRfoY2ejMgNkxafb6';

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Servidor de Respaldo Naisata (Render) Activo 🟢');
});

// Ruta de Emergencia SOS
app.post('/api/sos/engine', async (req, res) => {
    const { identifier, action } = req.body;
    
    if (!identifier || !['on', 'off'].includes(action)) {
        return res.status(400).json({ error: 'Datos inválidos' });
    }

    try {
        // En un caso real podrías conectarte aquí a MongoDB Atlas para buscar el ID Flespi basado en placas.
        // Pero para el modo de emergencia absoluto, asumiremos que se manda el Flespi ID directamente.
        const cleanId = String(identifier).trim();
        
        // Flespi 'setdigout': false (0) es encender/desbloquear. true (1) es apagar/bloquear.
        const value = action === 'on' ? false : true;
        
        const payload = [{
            "properties": {
                "name": "setdigout",
                "properties": { "value": value }
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
