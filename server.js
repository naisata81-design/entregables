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
    telefono: String,
    password: { type: String, required: true },
    firma: String,
    rol: { type: String, default: 'user' },
    usaHorarioPersonalizado: { type: Boolean, default: false },
    horariosPorDia: [{
        dia: Number,
        activo: Boolean,
        entrada: String,
        salida: String
    }]
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const SettingsSchema = new mongoose.Schema({
    tipo: { type: String, required: true, unique: true },
    toleranciaMinutos: { type: Number, default: 15 },
    horariosPorDia: [{
        dia: Number,
        activo: Boolean,
        entrada: String,
        salida: String
    }]
}, { timestamps: true });
const Settings = mongoose.model('Settings', SettingsSchema);

const CompanySchema = new mongoose.Schema({
    nombre: String,
    logo: String
}, { timestamps: true });
const Company = mongoose.model('Company', CompanySchema);

const SiteSchema = new mongoose.Schema({
    nombre: String,
    ubicacion: String,
    logo: String,
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
    nombreTecnico: String,
    estado: { type: String, default: 'pendiente' },
    descargasPdfCliente: { type: Number, default: 0 }
}, { timestamps: true });

const CheckInSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    tipo: { type: String, enum: ['Entrada', 'Salida'], required: true },
    servicio: { type: String, required: true },
    ubicacion: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    foto: { type: String }
}, { timestamps: true });

// Optimizar ordenamiento para evitar memory limits
TicketSchema.index({ siteId: 1, createdAt: -1 });

const Ticket = mongoose.model('Ticket', TicketSchema);
const CheckIn = mongoose.model('CheckIn', CheckInSchema);



// CORS Update para permitir solicitudes desde el front hospedado en otro sitio
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Exponer la carpeta de subidas en la raíz

// --- Endpoints ---

// 1. Registro (Register)
app.post('/api/register', async (req, res) => {
    try {
        const { nombre, apellido, correo, telefono, password, firma } = req.body;

        if (!nombre || !apellido || !correo || !telefono || !password || !firma) {
            return res.status(400).json({ error: 'Todos los campos y la firma son requeridos.' });
        }

        if (!correo.endsWith('@naisata.com')) {
            return res.status(403).json({ error: 'Acceso denegado. Correo no autorizado.' });
        }

        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        const newUser = new User({ nombre, apellido, correo, telefono, password, firma });
        await newUser.save();

        res.status(201).json({ message: 'Usuario registrado exitosamente', user: newUser });
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando el usuario.' });
    }
});

// 1.2 Obtener Usuarios (Para Admin)
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find().select('-password -firma').sort({ createdAt: -1 });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo usuarios.' });
    }
});

// 1.3 Asignar Horario Personalizado (Para Admin)
app.put('/api/users/:id/schedule', async (req, res) => {
    try {
        const { id } = req.params;
        const { usaHorarioPersonalizado, horariosPorDia } = req.body;
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        user.usaHorarioPersonalizado = usaHorarioPersonalizado || false;
        user.horariosPorDia = horariosPorDia || [];
        await user.save();
        res.json({ message: 'Horario actualizado', user });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando horario personalizado.' });
    }
});

// 1.5. Iniciar Sesión (Login)
app.post('/api/login', async (req, res) => {
    try {
        const { correo, password } = req.body;
        if (!correo || !password) return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });

        const user = await User.findOne({ correo });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        if (!user.password) {
            return res.status(403).json({ error: 'REQUIRE_PASSWORD_SETUP' });
        }

        if (user.password !== password) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        if (!user.firma) {
            return res.status(403).json({ error: 'REQUIRE_SIGNATURE_SETUP' });
        }

        res.status(200).json({ message: 'Inicio de sesión exitoso', user });
    } catch (e) {
        res.status(500).json({ error: 'Error interno en login.' });
    }
});

// 1.6 Configurar Contraseña (Cuentas Antiguas)
app.post('/api/set-password', async (req, res) => {
    try {
        const { correo, password } = req.body;
        if (!correo || !password) return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });

        const user = await User.findOne({ correo });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (user.password) return res.status(400).json({ error: 'Este usuario ya tiene una contraseña configurada.' });

        user.password = password;
        await user.save();

        res.status(200).json({ message: 'Contraseña configurada exitosamente', user });
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

// 1.7 Configurar Firma (Cuentas Antiguas sin firma)
app.post('/api/set-signature', async (req, res) => {
    try {
        const { correo, password, firma } = req.body;
        if (!correo || !password || !firma) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const user = await User.findOne({ correo });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (user.password !== password) return res.status(401).json({ error: 'Credenciales inválidas para configurar firma.' });
        if (user.firma) return res.status(400).json({ error: 'Este usuario ya tiene una firma registrada.' });

        user.firma = firma;
        await user.save();

        res.status(200).json({ message: 'Firma guardada exitosamente', user });
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
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

app.put('/api/companies/:id', upload.single('logo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre } = req.body;

        const company = await Company.findById(id);
        if (!company) return res.status(404).json({ error: 'Empresa no encontrada.' });

        if (nombre) company.nombre = nombre;

        if (req.file) {
            company.logo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }

        await company.save();
        io.emit('new_company', {}); // trigger refresh
        res.json({ message: 'Empresa actualizada', company: { ...company.toObject(), id: company._id.toString() } });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando empresa.' });
    }
});

app.delete('/api/companies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedCompany = await Company.findByIdAndDelete(id);
        if (!deletedCompany) return res.status(404).json({ error: 'Empresa no encontrada.' });

        // Unlink from sites
        await Site.updateMany({ companyId: id }, { $unset: { companyId: 1 } });
        // Unlink from tickets
        await Ticket.updateMany({ empresaId: id }, { $unset: { empresaId: 1 } });

        io.emit('deleted_company', { id });
        res.json({ message: 'Empresa eliminada correctamente' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando empresa.' });
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

app.post('/api/sites', upload.single('logo'), async (req, res) => {
    try {
        const { nombre, ubicacion, companyId } = req.body;
        if (!nombre || !ubicacion) return res.status(400).json({ error: 'Nombre y ubicación requeridos.' });

        const logoData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

        const newSite = new Site({ nombre, ubicacion, logo: logoData, companyId });
        await newSite.save();

        const responseObj = { ...newSite.toObject(), id: newSite._id.toString() };
        io.emit('new_site', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando sitio.' });
    }
});

app.put('/api/sites/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, ubicacion, companyId } = req.body;

        const site = await Site.findById(id);
        if (!site) return res.status(404).json({ error: 'Cliente no encontrado.' });

        if (nombre) site.nombre = nombre;
        if (ubicacion) site.ubicacion = ubicacion;
        site.companyId = companyId || '';

        await site.save();
        io.emit('new_site', {}); // trigger refresh
        res.json({ message: 'Cliente actualizado', site: { ...site.toObject(), id: site._id.toString() } });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando cliente.' });
    }
});

app.put('/api/sites/:id/logo', upload.single('logo'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ error: 'No se envió ninguna imagen.' });

        const logoData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const site = await Site.findById(id);
        if (!site) return res.status(404).json({ error: 'Cliente no encontrado.' });

        site.logo = logoData;
        await site.save();

        io.emit('new_site', {}); // Trigger a frontend reload of the list
        res.json({ message: 'Logo actualizado correctamente', logo: logoData });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando el logo.' });
    }
});

app.delete('/api/sites/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedSite = await Site.findByIdAndDelete(id);
        if (!deletedSite) return res.status(404).json({ error: 'Sitio no encontrado.' });

        // Also delete associated tickets
        await Ticket.deleteMany({ siteId: id });

        io.emit('deleted_site', { id });
        res.json({ message: 'Sitio eliminado correctamente' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando sitio.' });
    }
});

// 4. Tickets (Entregables)
app.get('/api/tickets/:siteId', async (req, res) => {
    try {
        const { siteId } = req.params;
        // Se habilita allowDiskUse para evitar el error QueryExceededMemoryLimitNoDiskUseAllowed
        const tickets = await Ticket.find({ siteId }).sort({ createdAt: -1 }).allowDiskUse(true);
        const mapped = tickets.map(t => {
            const obj = t.toObject();
            obj.id = t._id.toString();
            // Clean up potentially corrupted schema refs
            if (obj.empresaId === "") obj.empresaId = null;
            return obj;
        });
        res.json(mapped);
    } catch (e) {
        console.error("Error obteniendo tickets:", e);
        res.status(500).json({ error: 'Error obteniendo tickets.' });
    }
});

// Remote Sign: Get single ticket info
app.get('/api/ticket/single/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
        if (ticket.firmaCliente) {
            return res.json({
                alreadySigned: true,
                descargasRestantes: Math.max(0, 2 - (ticket.descargasPdfCliente || 0))
            });
        }

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

// Remote Download: Process generation constraints and return all populated data for PDF building
app.post('/api/ticket/single/:id/download-pdf', async (req, res) => {
    try {
        const ticketId = req.params.id;
        // Fetch ticket
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
        if (!ticket.firmaCliente) return res.status(403).json({ error: 'El ticket aún no ha sido firmado.' });

        const descargas = ticket.descargasPdfCliente || 0;
        if (descargas >= 2) {
            return res.status(403).json({ error: 'Has alcanzado el límite máximo de descargas (2/2).' });
        }

        // Increment count and save
        ticket.descargasPdfCliente = descargas + 1;
        await ticket.save();

        // Need Site and Company to build full PDF template
        const site = await Site.findById(ticket.siteId);
        let company = null;

        // Helper to check if string is a valid 24 hex char ObjectId
        const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

        if (site && site.companyId && isValidId(site.companyId)) {
            company = await Company.findById(site.companyId);
        } else if (ticket.empresaId && isValidId(ticket.empresaId)) {
            company = await Company.findById(ticket.empresaId);
        }

        res.json({
            ticket: { ...ticket.toObject(), id: ticket._id.toString() },
            site: site ? { ...site.toObject(), id: site._id.toString() } : null,
            company: company ? { ...company.toObject(), id: company._id.toString() } : null,
            descargasRestantes: 2 - ticket.descargasPdfCliente
        });

    } catch (e) {
        console.error("Download Error:", e);
        res.status(500).json({ error: 'Error interno al generar descarga.' });
    }
});

app.post('/api/tickets', upload.array('fotos', 15), async (req, res) => {
    try {
        const { folio, nombreTrabajo, descripcion, siteId, vendedor, firmaTecnico, firmaCliente, nombreCliente, nombreTecnico, empresaId } = req.body;

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
            empresaId: empresaId ? empresaId : null,
            fotos: fotosData,
            firmaTecnico: firmaTecnico || null,
            firmaCliente: firmaCliente || null,
            nombreCliente: nombreCliente || null,
            nombreTecnico: nombreTecnico || null,
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

app.post('/api/tickets/:id/photos', upload.array('fotos', 15), async (req, res) => {
    try {
        const ticketId = req.params.id;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No se enviaron fotos.' });
        }

        const ticket = await Ticket.findById(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket no encontrado.' });
        }

        const nuevasFotosData = req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);

        // Append to existing array or initialize if undefined
        if (!ticket.fotos) {
            ticket.fotos = [];
        }

        // Limit total photos if desired, or let it grow. For this feature, let's just append.
        // If we want a hard cap of e.g. 50 photos total, we could check here.
        ticket.fotos = ticket.fotos.concat(nuevasFotosData);

        await ticket.save();

        const responseObj = { ...ticket.toObject(), id: ticket._id.toString() };
        io.emit('new_ticket', responseObj); // Triggers frontend to reload
        res.status(200).json(responseObj);
    } catch (e) {
        console.error('Error adding photos to ticket:', e);
        res.status(500).json({ error: 'Error agregando fotos al ticket.' });
    }
});

// 5. Configuración de Reloj Checador (Settings)
app.get('/api/settings/timeclock', async (req, res) => {
    try {
        let settings = await Settings.findOne({ tipo: 'timeclock' });
        if (!settings) {
            settings = new Settings({
                tipo: 'timeclock',
                horariosPorDia: [
                    { dia: 1, activo: true, entrada: '09:00', salida: '18:00' },
                    { dia: 2, activo: true, entrada: '09:00', salida: '18:00' },
                    { dia: 3, activo: true, entrada: '09:00', salida: '18:00' },
                    { dia: 4, activo: true, entrada: '09:00', salida: '18:00' },
                    { dia: 5, activo: true, entrada: '09:00', salida: '18:00' },
                    { dia: 6, activo: true, entrada: '09:00', salida: '14:00' },
                    { dia: 0, activo: false, entrada: '', salida: '' }
                ]
            });
            await settings.save();
        }
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo configuraciones de checador.' });
    }
});

app.put('/api/settings/timeclock', async (req, res) => {
    try {
        const { horariosPorDia, toleranciaMinutos } = req.body;
        let settings = await Settings.findOne({ tipo: 'timeclock' });
        if (!settings) settings = new Settings({ tipo: 'timeclock' });

        if (horariosPorDia) settings.horariosPorDia = horariosPorDia;
        if (toleranciaMinutos !== undefined) settings.toleranciaMinutos = toleranciaMinutos;

        await settings.save();
        io.emit('settings_updated', settings);
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando configuraciones de checador.' });
    }
});

// 6. Reloj Checador (Time Clock)
app.post('/api/checkin', async (req, res) => {
    try {
        const { userId, userName, tipo, servicio, ubicacion, foto } = req.body;
        if (!userId || !userName || !tipo || !servicio || !ubicacion || !ubicacion.lat || !ubicacion.lng) {
            return res.status(400).json({ error: 'Faltan datos obligatorios para el registro.' });
        }

        const newCheckIn = new CheckIn({ userId, userName, tipo, servicio, ubicacion, foto });
        await newCheckIn.save();

        io.emit('new_checkin', newCheckIn);
        res.status(201).json(newCheckIn);
    } catch (e) {
        console.error('Error guardando registro de checador:', e);
        res.status(500).json({ error: 'Error guardando registro de checador.' });
    }
});

app.get('/api/checkins', async (req, res) => {
    try {
        const checkins = await CheckIn.find().sort({ createdAt: -1 }).limit(100);
        res.json(checkins);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo registros del checador.' });
    }
});




server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API ejecutándose en el puerto ${PORT}`);
});

io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});
