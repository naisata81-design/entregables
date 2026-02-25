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
    rol: { type: String, enum: ['admin', 'empleado'], default: 'empleado' }
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
    estado: { type: String, default: 'pendiente' }
}, { timestamps: true });
const Ticket = mongoose.model('Ticket', TicketSchema);

// --- HR & Admin Schemas ---
const ScheduleSchema = new mongoose.Schema({
    nombre: String,           // Ej: "Turno Matutino Oficina"
    horaEntrada: String,      // Ej: "08:00"
    horaSalida: String,       // Ej: "16:00"
    latitud: Number,          // GPS Geofence
    longitud: Number,
    radioMetros: Number,      // Radius for Geofence
    empleados: [String]       // Array of User IDs assigned to this schedule
}, { timestamps: true });
const Schedule = mongoose.model('Schedule', ScheduleSchema);

const AttendanceSchema = new mongoose.Schema({
    userId: String,
    fecha: String,            // YYYY-MM-DD
    horaEntrada: String,      // HH:mm:ss
    fotoEntrada: String,      // Base64
    gpsEntrada: {
        lat: Number,
        lng: Number
    },
    horaSalida: String,
    fotoSalida: String,
    gpsSalida: {
        lat: Number,
        lng: Number
    }
}, { timestamps: true });
const Attendance = mongoose.model('Attendance', AttendanceSchema);

const VacationSchema = new mongoose.Schema({
    userId: String,
    fechaInicio: String,      // YYYY-MM-DD
    fechaFin: String,
    estado: { type: String, enum: ['pendiente', 'aprobada', 'rechazada'], default: 'pendiente' }
}, { timestamps: true });
const Vacation = mongoose.model('Vacation', VacationSchema);

const AppConfigSchema = new mongoose.Schema({
    key: String,              // "vacationDaysNotice", "vacationDaysPerYear"
    value: String
}, { timestamps: true });
const AppConfig = mongoose.model('AppConfig', AppConfigSchema);

// CORS Update para permitir solicitudes desde el front hospedado en otro sitio
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Exponer la carpeta de subidas en la raíz

// --- Endpoints ---

// 1. Registro (Register)
app.post('/api/register', async (req, res) => {
    try {
        const { nombre, apellido, correo, telefono, password } = req.body;

        if (!nombre || !apellido || !correo || !telefono || !password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos.' });
        }

        if (!correo.endsWith('@naisata.com')) {
            return res.status(403).json({ error: 'Acceso denegado. Correo no autorizado.' });
        }

        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        const newUser = new User({ nombre, apellido, correo, telefono, password });
        await newUser.save();

        res.status(201).json({ message: 'Usuario registrado exitosamente', user: newUser });
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando el usuario.' });
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

        if (user.password === password) {
            res.status(200).json({ message: 'Inicio de sesión exitoso', user });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas.' });
        }
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

// --- HR & Admin Endpoints ---

// Users (for admin to assign schedules and manage roles)
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        const mapped = users.map(u => ({ ...u.toObject(), id: u._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo usuarios.' });
    }
});

app.put('/api/users/:id/role', async (req, res) => {
    try {
        const { rol } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        user.rol = rol;
        await user.save();
        res.json({ message: 'Rol actualizado', user: { ...user.toObject(), id: user._id.toString() } });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando rol.' });
    }
});

// Schedules (Horarios)
app.get('/api/schedules', async (req, res) => {
    try {
        const schedules = await Schedule.find().sort({ createdAt: -1 });
        const mapped = schedules.map(s => ({ ...s.toObject(), id: s._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo horarios.' });
    }
});

app.post('/api/schedules', async (req, res) => {
    try {
        const newSchedule = new Schedule(req.body);
        await newSchedule.save();
        res.status(201).json({ ...newSchedule.toObject(), id: newSchedule._id.toString() });
    } catch (e) {
        res.status(500).json({ error: 'Error guardando horario.' });
    }
});

app.put('/api/schedules/:id', async (req, res) => {
    try {
        const schedule = await Schedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!schedule) return res.status(404).json({ error: 'Horario no encontrado.' });
        res.json({ ...schedule.toObject(), id: schedule._id.toString() });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando horario.' });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    try {
        const deleted = await Schedule.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Horario no encontrado.' });
        res.json({ message: 'Horario eliminado' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando horario.' });
    }
});

// Attendance (Asistencia)
app.get('/api/attendance', async (req, res) => {
    try {
        // Option to filter by date or user
        const filter = {};
        if (req.query.fecha) filter.fecha = req.query.fecha;
        if (req.query.userId) filter.userId = req.query.userId;

        const records = await Attendance.find(filter).sort({ createdAt: -1 });
        const mapped = records.map(r => ({ ...r.toObject(), id: r._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo asistencias.' });
    }
});

// Sync Check-IN/OUT (can receive multiple from offline queue)
app.post('/api/attendance/sync', async (req, res) => {
    try {
        const records = req.body; // Array of attendance records
        if (!Array.isArray(records)) return res.status(400).json({ error: 'Debe ser un array de registros' });

        for (const record of records) {
            if (record.id && record.id.startsWith('temp_')) {
                // New record
                delete record.id;
                const newAtt = new Attendance(record);
                await newAtt.save();
            } else if (record.id) {
                // Update existing record (e.g. adding checkout info to a morning checkin)
                await Attendance.findByIdAndUpdate(record.id, record);
            } else {
                // Also treat as new if no ID
                const newAtt = new Attendance(record);
                await newAtt.save();
            }
        }
        io.emit('attendance_updated', {});
        res.json({ message: 'Asistencias sincronizadas' });
    } catch (e) {
        res.status(500).json({ error: 'Error sincronizando asistencias.' });
    }
});

// Vacations (Vacaciones)
app.get('/api/vacations', async (req, res) => {
    try {
        const filter = {};
        if (req.query.userId) filter.userId = req.query.userId;
        const vacs = await Vacation.find(filter).sort({ createdAt: -1 });
        const mapped = vacs.map(v => ({ ...v.toObject(), id: v._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo vacaciones.' });
    }
});

app.post('/api/vacations', async (req, res) => {
    try {
        const newVac = new Vacation(req.body);
        newVac.estado = 'pendiente';
        await newVac.save();
        io.emit('new_vacation_request', { ...newVac.toObject(), id: newVac._id.toString() });
        res.status(201).json({ ...newVac.toObject(), id: newVac._id.toString() });
    } catch (e) {
        res.status(500).json({ error: 'Error solicitando vacaciones.' });
    }
});

app.put('/api/vacations/:id/status', async (req, res) => {
    try {
        const vac = await Vacation.findById(req.params.id);
        if (!vac) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        vac.estado = req.body.estado; // 'aprobada' o 'rechazada'
        await vac.save();
        io.emit('vacation_status_changed', { ...vac.toObject(), id: vac._id.toString() });
        res.json({ message: 'Estado actualizado', vacation: { ...vac.toObject(), id: vac._id.toString() } });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando estado.' });
    }
});

// Config
app.get('/api/config', async (req, res) => {
    try {
        const configs = await AppConfig.find();
        const configMap = {};
        configs.forEach(c => configMap[c.key] = c.value);
        res.json(configMap);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo configuración.' });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        for (const [key, value] of Object.entries(req.body)) {
            await AppConfig.findOneAndUpdate({ key }, { value }, { upsert: true });
        }
        res.json({ message: 'Configuración actualizada' });
    } catch (e) {
        res.status(500).json({ error: 'Error guardando configuración.' });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API ejecutándose en el puerto ${PORT}`);
});
