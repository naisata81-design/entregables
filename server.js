const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Configuración de Multer para almacenar archivos en memoria (Base64)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { files: 15, fileSize: 15 * 1024 * 1024 } }); // 15MB max per file

// --- MongoDB Config ---
const MONGODB_URI = 'mongodb+srv://naisata:Hola2025@cluster0.vjplkwp.mongodb.net/naisata_db?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB excitósamente'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

// --- Schemas ---
const UserSchema = new mongoose.Schema({
    nombre: String,
    apellido: String,
    correo: String,
    telefono: String
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const CompanySchema = new mongoose.Schema({
    nombre: String,
    logo: String
}, { timestamps: true });
const Company = mongoose.model('Company', CompanySchema);

const SiteSchema = new mongoose.Schema({
    nombre: String,
    ubicacion: String,
    companyId: String
}, { timestamps: true });
const Site = mongoose.model('Site', SiteSchema);

const TicketSchema = new mongoose.Schema({
    folio: String,
    titulo: String,
    descripcion: String,
    siteId: String,
    vendedor: String,
    empresaId: String,
    fotos: [String],
    firmaTecnico: String,
    firmaCliente: String,
    nombreCliente: String,
    estado: { type: String, default: 'pendiente' }
}, { timestamps: true });
const Ticket = mongoose.model('Ticket', TicketSchema);

// CORS Update para permitir solicitudes desde el front hospedado en otro sitio
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Exponer la carpeta de subidas en la raíz

// --- Endpoints ---

// 1. Registro (Register)
app.post('/api/register', async (req, res) => {
    try {
        const { nombre, apellido, correo, telefono } = req.body;

        if (!nombre || !apellido || !correo || !telefono) {
            return res.status(400).json({ error: 'Todos los campos son requeridos.' });
        }

        if (!correo.endsWith('@naisata.com')) {
            return res.status(400).json({ error: 'Solo se permiten correos @naisata.com' });
        }

        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        const newUser = new User({ nombre, apellido, correo, telefono });
        await newUser.save();

        res.status(201).json({ message: 'Usuario registrado exitosamente', user: newUser });
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando el usuario.' });
    }
});

// 1.5. Iniciar Sesión (Login)
app.post('/api/login', async (req, res) => {
    try {
        const { correo } = req.body;
        if (!correo) return res.status(400).json({ error: 'El correo es requerido.' });

        const user = await User.findOne({ correo });
        if (user) {
            res.status(200).json({ message: 'Inicio de sesión exitoso', user });
        } else {
            res.status(401).json({ error: 'Correo no registrado.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Error interno en login.' });
    }
});

// 2. Empresas (Companies)
app.get('/api/companies', async (req, res) => {
    try {
        const companies = await Company.find().sort({ createdAt: -1 });
        // Map _id to id for backwards compatibility with frontend
        const mapped = companies.map(c => ({ ...c.toObject(), id: c._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo empresas.' });
    }
});

app.post('/api/companies', upload.single('logo'), async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: 'El nombre de la empresa es requerido.' });

        const logoData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

        const newCompany = new Company({ nombre, logo: logoData });
        await newCompany.save();

        const responseObj = { ...newCompany.toObject(), id: newCompany._id.toString() };
        io.emit('new_company', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

// 3. Sitios (Sites)
app.get('/api/sites', async (req, res) => {
    try {
        const sites = await Site.find().sort({ createdAt: -1 });
        const mapped = sites.map(s => ({ ...s.toObject(), id: s._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo sitios.' });
    }
});

app.post('/api/sites', async (req, res) => {
    try {
        const { nombre, ubicacion, companyId } = req.body;
        if (!nombre || !ubicacion) return res.status(400).json({ error: 'Nombre y ubicación requeridos.' });

        const newSite = new Site({ nombre, ubicacion, companyId });
        await newSite.save();

        const responseObj = { ...newSite.toObject(), id: newSite._id.toString() };
        io.emit('new_site', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando sitio.' });
    }
});

// 4. Tickets (Entregables)
app.get('/api/tickets/:siteId', async (req, res) => {
    try {
        const { siteId } = req.params;
        const tickets = await Ticket.find({ siteId }).sort({ createdAt: -1 });
        const mapped = tickets.map(t => ({ ...t.toObject(), id: t._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo tickets.' });
    }
});

// Remote Sign: Get single ticket info
app.get('/api/ticket/single/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
        if (ticket.firmaCliente) return res.status(403).json({ error: 'El ticket ya ha sido firmado por el cliente.' });

        // Send only necessary data for signature screen
        res.json({
            id: ticket._id.toString(),
            folio: ticket.folio,
            nombreTrabajo: ticket.titulo,
            descripcion: ticket.descripcion,
            fotos: ticket.fotos || []
        });
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Remote Sign: Save signature
app.post('/api/ticket/single/:id/sign', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { signature, nombreCliente } = req.body;

        if (!signature) return res.status(400).json({ error: 'La firma es requerida.' });
        if (!nombreCliente) return res.status(400).json({ error: 'El nombre del cliente es requerido.' });

        const ticket = await Ticket.findById(ticketId);

        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
        if (ticket.firmaCliente) return res.status(403).json({ error: 'Este ticket ya fue firmado.' });

        ticket.firmaCliente = signature;
        ticket.nombreCliente = nombreCliente;
        ticket.estado = 'Terminado';
        await ticket.save();

        io.emit('ticket_signed', { ticketId: ticket._id.toString() });

        res.json({ message: 'Firma guardada correctamente' });
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/api/tickets', upload.array('fotos', 15), async (req, res) => {
    try {
        const { folio, nombreTrabajo, descripcion, siteId, vendedor, firmaTecnico, firmaCliente, nombreCliente, empresaId } = req.body;

        if (!folio || !nombreTrabajo || !descripcion || !siteId) {
            return res.status(400).json({ error: 'Faltan datos obligatorios del ticket.' });
        }

        const fotosData = req.files ? req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`) : [];

        const newTicket = new Ticket({
            folio,
            titulo: nombreTrabajo,
            descripcion,
            siteId,
            vendedor: vendedor || '',
            empresaId: empresaId || null,
            fotos: fotosData,
            firmaTecnico: firmaTecnico || null,
            firmaCliente: firmaCliente || null,
            nombreCliente: nombreCliente || null,
            estado: 'pendiente'
        });

        await newTicket.save();

        const responseObj = { ...newTicket.toObject(), id: newTicket._id.toString() };
        io.emit('new_ticket', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error guardando ticket.' });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API ejecutándose en el puerto ${PORT}`);
});
