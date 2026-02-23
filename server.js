const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data'); // Added DATA_DIR constant

// Configuración de Multer para almacenar archivos de forma local
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage, limits: { files: 15 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta explícita para servir socket.io client si falla por SPA
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// Helpers to read and write JSON
const readData = (filename) => {
    try {
        const data = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'); // Using DATA_DIR
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filename}:`, error);
        return [];
    }
};

const writeData = (filename, data) => {
    try {
        fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8'); // Using DATA_DIR
        return true;
    } catch (error) {
        console.error(`Error writing ${filename}:`, error);
        return false;
    }
};

// --- Endpoints ---

// 1. Registro (Register)
app.post('/api/register', (req, res) => {
    const { nombre, apellido, correo, telefono } = req.body;

    if (!nombre || !apellido || !correo || !telefono) {
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    if (!correo.endsWith('@naisata.com')) {
        return res.status(400).json({ error: 'Solo se permiten correos @naisata.com' });
    }

    const users = readData('users.json');

    // Check if user already exists
    if (users.some(u => u.correo === correo)) {
        return res.status(400).json({ error: 'El correo ya está registrado.' });
    }

    const newUser = { id: Date.now().toString(), nombre, apellido, correo, telefono };
    users.push(newUser);

    if (writeData('users.json', users)) {
        res.status(201).json({ message: 'Usuario registrado exitosamente', user: newUser });
    } else {
        res.status(500).json({ error: 'Error interno guardando el usuario.' });
    }
});

// 1.5. Iniciar Sesión (Login)
app.post('/api/login', (req, res) => {
    const { correo } = req.body;

    if (!correo) {
        return res.status(400).json({ error: 'El correo es requerido.' });
    }

    const users = readData('users.json');
    const user = users.find(u => u.correo === correo);

    if (user) {
        res.status(200).json({ message: 'Inicio de sesión exitoso', user });
    } else {
        res.status(401).json({ error: 'Correo no registrado.' });
    }
});

// 2. Empresas (Companies)
app.get('/api/companies', (req, res) => {
    const companies = readData('companies.json');
    res.json(companies);
});

app.post('/api/companies', upload.single('logo'), (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre de la empresa es requerido.' });

    const logoPath = req.file ? `/uploads/${req.file.filename}` : null;

    const companies = readData('companies.json');
    const newCompany = { id: Date.now().toString(), nombre, logo: logoPath };
    companies.push(newCompany);

    if (writeData('companies.json', companies)) {
        io.emit('new_company', newCompany);
        res.status(201).json(newCompany);
    } else {
        res.status(500).json({ error: 'Error interno.' });
    }
});

// 3. Sitios (Sites)
app.get('/api/sites', (req, res) => {
    const sites = readData('sites.json');
    res.json(sites);
});

app.post('/api/sites', (req, res) => {
    const { nombre, ubicacion, companyId } = req.body; // Opcional asociar a company, lo agrego por si acaso
    if (!nombre || !ubicacion) return res.status(400).json({ error: 'Nombre y ubicación requeridos.' });

    const sites = readData('sites.json');
    const newSite = { id: Date.now().toString(), nombre, ubicacion, companyId };
    sites.push(newSite);

    if (writeData('sites.json', sites)) {
        io.emit('new_site', newSite);
        res.status(201).json(newSite);
    } else {
        res.status(500).json({ error: 'Error interno.' });
    }
});

// 4. Tickets (Entregables)
app.get('/api/tickets/:siteId', (req, res) => {
    const { siteId } = req.params;
    const tickets = readData('tickets.json').filter(t => t.siteId === siteId);
    res.json(tickets);
});

// Remote Sign: Get single ticket info
app.get('/api/ticket/single/:id', (req, res) => {
    const ticketId = req.params.id;
    const tickets = readData('tickets.json');
    const ticket = tickets.find(t => t.id === ticketId);

    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
    if (ticket.firmaCliente) return res.status(403).json({ error: 'El ticket ya ha sido firmado por el cliente.' });

    // Send only necessary data for signature screen
    res.json({
        id: ticket.id,
        folio: ticket.folio,
        nombreTrabajo: ticket.titulo,
        descripcion: ticket.descripcion,
        fotos: ticket.fotos || []
    });
});

// Remote Sign: Save signature
app.post('/api/ticket/single/:id/sign', (req, res) => {
    const ticketId = req.params.id;
    const { signature } = req.body; // Base64 PNG string

    if (!signature) return res.status(400).json({ error: 'La firma es requerida.' });

    let tickets = readData('tickets.json');
    const tIndex = tickets.findIndex(t => t.id === ticketId);

    if (tIndex === -1) return res.status(404).json({ error: 'Ticket no encontrado.' });
    if (tickets[tIndex].firmaCliente) return res.status(403).json({ error: 'Este ticket ya fue firmado.' });

    tickets[tIndex].firmaCliente = signature;
    tickets[tIndex].estado = 'Terminado'; // Auto-mark completed if desired
    writeData('tickets.json', tickets);

    // Notify all connected clients (dashboard) to refresh
    io.emit('ticket_signed', { ticketId });

    res.json({ message: 'Firma guardada correctamente' });
});

app.post('/api/tickets', upload.array('fotos', 15), (req, res) => {
    // Nuevos campos agregados
    const { folio, nombreTrabajo, descripcion, siteId, vendedor, firmaTecnico, firmaCliente, empresaId } = req.body;

    if (!folio || !nombreTrabajo || !descripcion || !siteId) {
        return res.status(400).json({ error: 'Faltan datos obligatorios del ticket.' });
    }

    // Archivos procesados por multer
    const fotosPaths = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const tickets = readData('tickets.json');
    const newTicket = {
        id: Date.now().toString(),
        folio,
        titulo: nombreTrabajo, // Re-uso 'titulo' para mantener compatibilidad
        descripcion,
        siteId,
        vendedor: vendedor || '',
        empresaId: empresaId || null,
        fotos: fotosPaths,
        firmaTecnico: firmaTecnico || null, // Guardaremos Base64 desde el front
        firmaCliente: firmaCliente || null,
        estado: 'pendiente'
    };

    tickets.push(newTicket);

    if (writeData('tickets.json', tickets)) {
        io.emit('new_ticket', newTicket);
        res.status(201).json(newTicket);
    } else {
        res.status(500).json({ error: 'Error interno guardando ticket.' });
    }
});


// Serve base HTML for any other route (SPA)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Servidor de Naisata ejecutándose en http://localhost:${PORT}`);
});
