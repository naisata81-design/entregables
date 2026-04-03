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
    }],
    diasVacacionesDisponibles: { type: Number, default: 0 },
    fotoPerfil: { type: String, default: '' }
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
    ordenCompra: String,
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
    foto: { type: String },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const VacationRequestSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, required: true },
    diasSolicitados: { type: Number, required: true },
    motivo: { type: String, required: true },
    estado: { type: String, enum: ['pendiente', 'aprobada', 'rechazada'], default: 'pendiente' }
}, { timestamps: true });

// Optimizar ordenamiento para evitar memory limits
TicketSchema.index({ siteId: 1, createdAt: -1 });
VacationRequestSchema.index({ userId: 1, createdAt: -1 });

const Ticket = mongoose.model('Ticket', TicketSchema);
const CheckIn = mongoose.model('CheckIn', CheckInSchema);
const VacationRequest = mongoose.model('VacationRequest', VacationRequestSchema);

const ProjectSchema = new mongoose.Schema({
    nombre: String,
    descripcion: String
}, { timestamps: true });
const ProjectModel = mongoose.model('Project', ProjectSchema);

const PlanSchema = new mongoose.Schema({
    nombre: String,
    imagen: String, // Base64
    proyectoId: String
}, { timestamps: true });
const PlanModel = mongoose.model('Plan', PlanSchema);

const PlanMarkerSchema = new mongoose.Schema({
    planId: String,
    x: Number,
    y: Number,
    tipo: String, // 'Nodo Simple', 'Cámara', etc.
    codigo: String,
    estado: { type: String, default: 'Pendiente' },
    notas: { type: String, default: '' }
}, { timestamps: true });
const PlanMarker = mongoose.model('PlanMarker', PlanMarkerSchema);

const InventoryItemSchema = new mongoose.Schema({
    tipo: { type: String, enum: ['Insumo', 'Herramienta'], required: true },
    nombre: { type: String, required: true },
    numeroParte: { type: String, required: true, unique: true },
    marca: { type: String, default: '' },
    ubicacion: { type: String, default: '' },
    cantidadDescompuesta: { type: Number, default: 0 },
    historialFallas: [{
        fecha: { type: Date, default: Date.now },
        reportadoPor: String,
        falla: String,
        cantidad: Number,
        solucionado: { type: Boolean, default: false },
        fechaSolucion: Date,
        enCampo: { type: Boolean, default: false }
    }]
}, { timestamps: true });
const InventoryItem = mongoose.model('InventoryItem', InventoryItemSchema);

const InventoryTransactionSchema = new mongoose.Schema({
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    tipoMovimiento: { type: String, enum: ['Salida', 'Devolucion', 'Entrada'], required: true },
    cantidad: { type: Number, required: true },
    responsable: { type: String, required: true },
    firma: { type: String, required: true }, // Base64
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });
const InventoryTransaction = mongoose.model('InventoryTransaction', InventoryTransactionSchema);


// CORS Update para permitir solicitudes desde el front hospedado en otro sitio
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Exponer la carpeta de subidas en la raíz

// --- Endpoints ---

// 1. Registro (Register)
app.post('/api/register', async (req, res) => {
    try {
        const { nombre, apellido, correo, telefono, password, firma, fotoPerfil } = req.body;

        if (!nombre || !apellido || !correo || !telefono || !password || !firma || !fotoPerfil) {
            return res.status(400).json({ error: 'Todos los campos, foto de perfil y la firma son requeridos.' });
        }

        if (!correo.endsWith('@naisata.com')) {
            return res.status(403).json({ error: 'Acceso denegado. Correo no autorizado.' });
        }

        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        const newUser = new User({ nombre, apellido, correo, telefono, password, firma, fotoPerfil });
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

// 1.2.1 Obtener Usuario Específico
app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -firma');
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo al usuario.' });
    }
});

// 1.2.2 Obtener Estadísticas de Empleado (Dashboard)
app.get('/api/users/:id/dashboard-stats', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId).select('nombre apellido diasVacacionesDisponibles horariosPorDia usaHorarioPersonalizado rol');
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const fullName = `${user.nombre} ${user.apellido}`;

        // 1. Calcular retardos históricos
        const checkins = await CheckIn.find({ userId: userId, tipo: 'Entrada' });
        let settings = await Settings.findOne({ tipo: 'timeclock' });
        const globalTolerancia = settings ? settings.toleranciaMinutos : 15;
        const globalHorarios = settings ? settings.horariosPorDia : [];

        let retardosTotales = 0;
        for (const checkin of checkins) {
            const date = new Date(checkin.timestamp);
            const dayOfWeek = date.getDay();
            let horarioDia;
            if (user.usaHorarioPersonalizado && user.horariosPorDia) {
                horarioDia = user.horariosPorDia.find(h => h.dia === dayOfWeek);
            } else {
                horarioDia = globalHorarios.find(h => h.dia === dayOfWeek);
            }

            if (horarioDia && horarioDia.activo && horarioDia.entrada) {
                const [h, m] = horarioDia.entrada.split(':').map(Number);
                const entryTimeMinutes = h * 60 + m;
                const checkinTimeMinutes = date.getHours() * 60 + date.getMinutes();
                if (checkinTimeMinutes > (entryTimeMinutes + globalTolerancia)) {
                    retardosTotales++;
                }
            }
        }

        // 2. Calcular herramientas prestadas al empleado (Inventario Actual)
        const transactions = await InventoryTransaction.find({ 
            responsable: { $in: [fullName, user.nombre, user.nombre.trim()] } 
        }).populate('itemId');
        const countMap = {}; // itemId -> net quantity

        for (const t of transactions) {
            if (t.itemId && t.itemId.tipo === 'Herramienta') {
                const idStr = t.itemId._id.toString();
                if (!countMap[idStr]) {
                    countMap[idStr] = {
                        item: { id: idStr, nombre: t.itemId.nombre, numeroParte: t.itemId.numeroParte },
                        cantidad: 0
                    };
                }
                if (t.tipoMovimiento === 'Salida') {
                    countMap[idStr].cantidad += t.cantidad;
                } else if (t.tipoMovimiento === 'Devolucion') {
                    countMap[idStr].cantidad -= t.cantidad;
                }
            }
        }

        const herramientasActuales = Object.values(countMap).filter(v => v.cantidad > 0);

        // 3. Historial de una Semana
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const weeklyTransactionsRaw = await InventoryTransaction.find({ 
            responsable: { $in: [fullName, user.nombre, user.nombre.trim()] },
            fecha: { $gte: sevenDaysAgo }
        }).sort({ fecha: -1 }).populate('itemId');

        const weeklyHistory = weeklyTransactionsRaw.filter(t => t.itemId && t.itemId.tipo === 'Herramienta').map(t => ({
            id: t._id.toString(),
            tipoMovimiento: t.tipoMovimiento,
            cantidad: t.cantidad,
            fecha: t.fecha,
            itemNombre: t.itemId.nombre,
            itemNumeroParte: t.itemId.numeroParte
        }));

        res.json({
            diasVacacionesDisponibles: user.diasVacacionesDisponibles,
            retardosTotales,
            herramientasActuales,
            weeklyHistory
        });

    } catch (e) {
        console.error('Error calculando stats de dashboard:', e);
        res.status(500).json({ error: 'Error calculando estadisticas del empleado.' });
    }
});

// 1.3 Asignar Horario Personalizado y Vacaciones (Para Admin)
app.put('/api/users/:id/schedule', async (req, res) => {
    try {
        const { id } = req.params;
        const { usaHorarioPersonalizado, horariosPorDia, diasVacacionesDisponibles, rol } = req.body;
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (usaHorarioPersonalizado !== undefined) user.usaHorarioPersonalizado = usaHorarioPersonalizado;
        if (horariosPorDia !== undefined) user.horariosPorDia = horariosPorDia;
        if (diasVacacionesDisponibles !== undefined) user.diasVacacionesDisponibles = diasVacacionesDisponibles;
        if (rol !== undefined && ['admin', 'user', 'Clase C'].includes(rol)) user.rol = rol;

        await user.save();
        res.json({ message: 'Ajustes del usuario actualizados', user });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando ajustes del usuario.' });
    }
});

// 1.3.1 Restablecer Contraseña (Para Admin)
app.put('/api/users/:id/reset-password', async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        if (!newPassword) return res.status(400).json({ error: 'La nueva contraseña es requerida.' });

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        user.password = newPassword;
        await user.save();
        
        res.json({ message: 'Contraseña actualizada correctamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando contraseña.' });
    }
});

// 1.4 Actualizar Foto de Perfil
app.put('/api/users/:id/photo', async (req, res) => {
    try {
        const { id } = req.params;
        const { fotoPerfil } = req.body;

        if (!fotoPerfil) return res.status(400).json({ error: 'Falta la foto de perfil en la solicitud.' });

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        user.fotoPerfil = fotoPerfil;
        await user.save();
        res.json({ message: 'Foto de perfil actualizada', fotoPerfil: user.fotoPerfil });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando foto de perfil.' });
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

        if (!user.fotoPerfil) {
            return res.status(403).json({ error: 'REQUIRE_PHOTO_SETUP' });
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

// 1.8 Configurar Foto de Perfil (Cuentas Antiguas sin foto)
app.post('/api/set-photo', async (req, res) => {
    try {
        const { correo, password, fotoPerfil } = req.body;
        if (!correo || !password || !fotoPerfil) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const user = await User.findOne({ correo });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (user.password !== password) return res.status(401).json({ error: 'Credenciales inválidas para configurar foto.' });
        if (user.fotoPerfil) return res.status(400).json({ error: 'Este usuario ya tiene una foto de perfil registrada.' });

        user.fotoPerfil = fotoPerfil;
        await user.save();

        res.status(200).json({ message: 'Foto de perfil guardada exitosamente', user });
    } catch (e) {
        res.status(500).json({ error: 'Error interno al guardar foto.' });
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
        // Excluimos las fotos para no saturar la red y memoria (se descargarán cuando se pida el PDF). Mantenemos firmas para la UI.
        const tickets = await Ticket.find({ siteId }).select('-fotos').sort({ createdAt: -1 }).allowDiskUse(true);
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

// Admin Download: Get full ticket info for PDF (including heavy photos and signatures)
app.get('/api/tickets/full/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const ticket = await Ticket.findById(ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

        const obj = ticket.toObject();
        obj.id = ticket._id.toString();
        res.json(obj);
    } catch (e) {
        console.error("Error obteniendo ticket completo:", e);
        res.status(500).json({ error: 'Error interno obteniendo detalles completos.' });
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
        const { folio, nombreTrabajo, descripcion, siteId, vendedor, firmaTecnico, firmaCliente, nombreCliente, nombreTecnico, empresaId, ordenCompra } = req.body;

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
            ordenCompra: ordenCompra || '',
            fotos: fotosData,
            firmaTecnico: firmaTecnico || null,
            firmaCliente: firmaCliente || null,
            nombreCliente: nombreCliente || null,
            nombreTecnico: nombreTecnico || null,
            estado: 'pendiente'
        });

        await newTicket.save();

        const responseObj = { ...newTicket.toObject(), id: newTicket._id.toString() };
        delete responseObj.fotos; // Strip heavy photos from WebSocket payload
        io.emit('new_ticket', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        console.error("Error en POST /api/tickets:", e);
        res.status(500).json({ error: 'Error guardando ticket en el servidor.' });
    }
});

// Edit ticket
app.put('/api/tickets/:id', upload.array('fotos', 15), async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { folio, nombreTrabajo, descripcion, vendedor, nombreTecnico, ordenCompra, siteId } = req.body;

        const ticket = await Ticket.findById(ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

        if (folio !== undefined) ticket.folio = folio;
        if (nombreTrabajo !== undefined) ticket.titulo = nombreTrabajo;
        if (descripcion !== undefined) ticket.descripcion = descripcion;
        if (vendedor !== undefined) ticket.vendedor = vendedor;
        if (nombreTecnico !== undefined) ticket.nombreTecnico = nombreTecnico;
        if (ordenCompra !== undefined) ticket.ordenCompra = ordenCompra;
        if (siteId) ticket.siteId = siteId;

        if (req.files && req.files.length > 0) {
            const nuevasFotosData = req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
            if (!ticket.fotos) ticket.fotos = [];
            ticket.fotos = ticket.fotos.concat(nuevasFotosData);
        }

        await ticket.save();

        const responseObj = { ...ticket.toObject(), id: ticket._id.toString() };
        delete responseObj.fotos; // Strip heavy photos from WebSocket payload
        io.emit('new_ticket', responseObj); // Trigger update on clients
        res.status(200).json(responseObj);
    } catch (e) {
        console.error('Error editing ticket:', e);
        res.status(500).json({ error: 'Error actualizando ticket.' });
    }
});

// Delete ticket
app.delete('/api/tickets/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const ticket = await Ticket.findByIdAndDelete(ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

        io.emit('delete_ticket', ticketId);
        res.status(200).json({ message: 'Ticket eliminado con éxito' });
    } catch (e) {
        console.error('Error eliminando ticket:', e);
        res.status(500).json({ error: 'Error interno eliminando ticket.' });
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
        res.status(500).json({ error: 'Error agregando fotos al ticket en el servidor.' });
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
        const { userId, userName, tipo, servicio, ubicacion, foto, timestamp } = req.body;
        if (!userId || !userName || !tipo || !servicio || !ubicacion || !ubicacion.lat || !ubicacion.lng) {
            return res.status(400).json({ error: 'Faltan datos obligatorios para el registro.' });
        }

        const newCheckIn = new CheckIn({ userId, userName, tipo, servicio, ubicacion, foto });
        if (timestamp) {
            newCheckIn.timestamp = new Date(timestamp);
        }
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
        // Excluimos 'foto' para no sobrecargar el ancho de banda
        const checkins = await CheckIn.find().select('-foto').sort({ createdAt: -1 }).limit(100);
        res.json(checkins);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo registros del checador.' });
    }
});

// Endpoint para el "Empleado de la Semana"
app.get('/api/employee-of-the-week', async (req, res) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Fetch Entradas from the last 7 days
        const checkins = await CheckIn.find({
            tipo: 'Entrada',
            timestamp: { $gte: sevenDaysAgo }
        });

        if (checkins.length === 0) {
            return res.json({ winner: null });
        }

        let settings = await Settings.findOne({ tipo: 'timeclock' });
        const globalTolerancia = settings ? settings.toleranciaMinutos : 15;
        const globalHorarios = settings ? settings.horariosPorDia : [];

        // Pre-fetch users to get their schedules
        const users = await User.find({ rol: { $in: ['user', 'Clase C'] } });
        const userMap = {};
        users.forEach(u => userMap[u._id.toString()] = u);

        const userStats = {}; // userId -> stat tracker

        for (const checkin of checkins) {
            const uid = checkin.userId;
            if (!userMap[uid]) continue; // Ignore admins or deleted users

            if (!userStats[uid]) {
                userStats[uid] = {
                    nombre: userMap[uid].nombre,
                    apellido: userMap[uid].apellido,
                    fotoPerfil: userMap[uid].fotoPerfil,
                    retardos: 0,
                    totalCheckins: 0
                };
            }

            userStats[uid].totalCheckins++;

            // Retardo logic
            const u = userMap[uid];
            const date = new Date(checkin.timestamp);
            const dayOfWeek = date.getDay(); // 0(Sun) - 6(Sat)

            let horarioDia;
            if (u.usaHorarioPersonalizado && u.horariosPorDia) {
                horarioDia = u.horariosPorDia.find(h => h.dia === dayOfWeek);
            } else {
                horarioDia = globalHorarios.find(h => h.dia === dayOfWeek);
            }

            if (horarioDia && horarioDia.activo && horarioDia.entrada) {
                const [h, m] = horarioDia.entrada.split(':').map(Number);
                const entryTimeMinutes = h * 60 + m;
                const checkinTimeMinutes = date.getHours() * 60 + date.getMinutes();

                if (checkinTimeMinutes > (entryTimeMinutes + globalTolerancia)) {
                    userStats[uid].retardos++;
                }
            }
        }

        // Find the winner: Minimum retardos, but must have the highest checkins in case of a tie
        let winner = null;
        let minRetardos = Infinity;
        let maxCheckins = 0;

        for (const uid in userStats) {
            const stat = userStats[uid];
            if (stat.retardos < minRetardos) {
                minRetardos = stat.retardos;
                maxCheckins = stat.totalCheckins;
                winner = stat;
            } else if (stat.retardos === minRetardos) {
                // Tie breaker: The one who showed up more times wins
                if (stat.totalCheckins > maxCheckins) {
                    maxCheckins = stat.totalCheckins;
                    winner = stat;
                }
            }
        }

        res.json({ winner });

    } catch (e) {
        console.error('Error calculando empleado de la semana:', e);
        res.status(500).json({ error: 'Error interno obteniendo empleado de la semana.' });
    }
});

// 7. Vacaciones (Vacation Requests)
app.post('/api/vacations', async (req, res) => {
    try {
        const { userId, userName, fechaInicio, fechaFin, diasSolicitados, motivo } = req.body;

        if (!userId || !fechaInicio || !fechaFin || !diasSolicitados || !motivo) {
            return res.status(400).json({ error: 'Faltan datos obligatorios para la solicitud.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (user.diasVacacionesDisponibles < diasSolicitados) {
            return res.status(400).json({ error: 'No tienes suficientes días de vacaciones disponibles.' });
        }

        const newRequest = new VacationRequest({
            userId, userName, fechaInicio, fechaFin, diasSolicitados, motivo
        });

        await newRequest.save();
        res.status(201).json(newRequest);
    } catch (e) {
        res.status(500).json({ error: 'Error guardando solicitud de vacaciones.' });
    }
});

app.get('/api/vacations', async (req, res) => {
    try {
        const { userId } = req.query;
        let requests;
        if (userId) {
            requests = await VacationRequest.find({ userId }).sort({ createdAt: -1 });
        } else {
            requests = await VacationRequest.find().sort({ createdAt: -1 });
        }
        res.json(requests);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo solicitudes de vacaciones.' });
    }
});

app.put('/api/vacations/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body; // 'aprobada' o 'rechazada'

        if (!['aprobada', 'rechazada'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const request = await VacationRequest.findById(id);
        if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });

        if (request.estado !== 'pendiente') {
            return res.status(400).json({ error: 'La solicitud ya ha sido procesada.' });
        }

        request.estado = estado;

        if (estado === 'aprobada') {
            const user = await User.findById(request.userId);
            if (user && user.diasVacacionesDisponibles >= request.diasSolicitados) {
                user.diasVacacionesDisponibles -= request.diasSolicitados;
                await user.save();
            } else {
                return res.status(400).json({ error: 'El usuario ya no tiene suficientes días para aprobar la solicitud.' });
            }
        }

        await request.save();
        res.json(request);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando estado de la solicitud.' });
    }
});


// --- Interactive Plans & Markers ---
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await ProjectModel.find().sort({ createdAt: -1 });
        const mapped = projects.map(p => ({ ...p.toObject(), id: p._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo proyectos.' });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { nombre, descripcion } = req.body;
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
        const newProject = new ProjectModel({ nombre, descripcion });
        await newProject.save();
        const responseObj = { ...newProject.toObject(), id: newProject._id.toString() };
        io.emit('new_project', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error agregando proyecto.' });
    }
});

app.get('/api/plans/project/:proyectoId', async (req, res) => {
    try {
        const { proyectoId } = req.params;
        const plans = await PlanModel.find({ proyectoId }).sort({ createdAt: -1 });
        const mapped = plans.map(p => ({ ...p.toObject(), id: p._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo planos.' });
    }
});

app.post('/api/plans', upload.single('imagen'), async (req, res) => {
    try {
        const { nombre, proyectoId } = req.body;
        if (!nombre || !proyectoId) return res.status(400).json({ error: 'Nombre y proyectoId son requeridos.' });

        const imagenData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
        if (!imagenData) return res.status(400).json({ error: 'La imagen del plano es obligatoria.' });

        const newPlan = new PlanModel({ nombre, imagen: imagenData, proyectoId });
        await newPlan.save();

        const responseObj = { ...newPlan.toObject(), id: newPlan._id.toString() };
        io.emit('new_plan', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando plano.' });
    }
});

app.delete('/api/plans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedPlan = await PlanModel.findByIdAndDelete(id);
        if (!deletedPlan) return res.status(404).json({ error: 'Plano no encontrado.' });

        await PlanMarker.deleteMany({ planId: id });
        io.emit('deleted_plan', { id });
        res.json({ message: 'Plano eliminado correctamente' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando plano.' });
    }
});

app.get('/api/plans/:id/markers', async (req, res) => {
    try {
        const { id } = req.params;
        const markers = await PlanMarker.find({ planId: id });
        const mapped = markers.map(m => ({ ...m.toObject(), id: m._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo marcadores.' });
    }
});

app.post('/api/plans/:id/markers', async (req, res) => {
    try {
        const planId = req.params.id;
        const { x, y, tipo, codigo } = req.body;
        if (x == null || y == null || !tipo || !codigo) {
            return res.status(400).json({ error: 'Faltan datos del marcador.' });
        }

        const newMarker = new PlanMarker({ planId, x, y, tipo, codigo });
        await newMarker.save();

        const responseObj = { ...newMarker.toObject(), id: newMarker._id.toString() };
        io.emit('new_marker', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error guardando marcador.' });
    }
});

app.put('/api/markers/:id', async (req, res) => {
    try {
        const markerId = req.params.id;
        const { estado, notas } = req.body;

        const marker = await PlanMarker.findById(markerId);
        if (!marker) return res.status(404).json({ error: 'Marcador no encontrado.' });

        if (estado !== undefined) marker.estado = estado;
        if (notas !== undefined) marker.notas = notas;

        await marker.save();
        const responseObj = { ...marker.toObject(), id: marker._id.toString() };
        io.emit('update_marker', responseObj);
        res.json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando marcador.' });
    }
});

app.delete('/api/markers/:id', async (req, res) => {
    try {
        const markerId = req.params.id;
        const deletedMarker = await PlanMarker.findByIdAndDelete(markerId);
        if (!deletedMarker) return res.status(404).json({ error: 'Marcador no encontrado.' });

        io.emit('delete_marker', markerId);
        res.json({ message: 'Marcador eliminado.' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando marcador.' });
    }
});


// --- Inventory Endpoints ---
app.get('/api/inventory', async (req, res) => {
    try {
        const items = await InventoryItem.find().sort({ createdAt: -1 });
        const mapped = items.map(i => ({ ...i.toObject(), id: i._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo inventario.' });
    }
});

app.post('/api/inventory', async (req, res) => {
    try {
        let { tipo, nombre, numeroParte, marca, ubicacion, cantidadEnStock } = req.body;
        
        if (!tipo || !nombre) {
            return res.status(400).json({ error: 'Falta tipo o nombre del ítem.' });
        }
        
        if (!numeroParte) {
            // Need brand and location if part number is auto-generated
            if (!marca || !ubicacion) {
                return res.status(400).json({ error: 'Marca y Ubicación son requeridos si no hay Número de Parte.' });
            }
            // Generate part number: first 2 chars of name + 3 random digits
            const prefix = nombre.substring(0, 2).toUpperCase();
            const randomDigits = Math.floor(100 + Math.random() * 900);
            numeroParte = `${prefix}${randomDigits}`;
        }
        
        // Force uppercase for standardization
        tipo = tipo.toUpperCase() === 'HERRAMIENTA' ? 'Herramienta' : 'Insumo';
        nombre = nombre.toUpperCase();
        numeroParte = numeroParte.toUpperCase();
        marca = (marca || '').toUpperCase();
        ubicacion = (ubicacion || '').toUpperCase();
        cantidadEnStock = parseInt(cantidadEnStock) || 0;

        const newItem = new InventoryItem({
            tipo, nombre, numeroParte, marca, ubicacion, cantidadEnStock
        });
        await newItem.save();
        
        const responseObj = { ...newItem.toObject(), id: newItem._id.toString() };
        io.emit('new_inventory_item', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        if (e.code === 11000) {
            return res.status(400).json({ error: 'El número de parte ya existe.' });
        }
        res.status(500).json({ error: 'Error guardando en el inventario.' });
    }
});

app.put('/api/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let { tipo, nombre, numeroParte, marca, ubicacion, cantidadEnStock } = req.body;
        
        const item = await InventoryItem.findById(id);
        if (!item) return res.status(404).json({ error: 'Item no encontrado.' });
        
        if (tipo) item.tipo = tipo.toUpperCase() === 'HERRAMIENTA' ? 'Herramienta' : 'Insumo';
        if (nombre) item.nombre = nombre.toUpperCase();
        if (numeroParte) item.numeroParte = numeroParte.toUpperCase();
        if (marca !== undefined) item.marca = marca.toUpperCase();
        if (ubicacion !== undefined) item.ubicacion = ubicacion.toUpperCase();
        if (cantidadEnStock !== undefined) item.cantidadEnStock = parseInt(cantidadEnStock) || 0;
        
        await item.save();
        
        const responseObj = { ...item.toObject(), id: item._id.toString() };
        io.emit('update_inventory_item', responseObj);
        res.json(responseObj);
    } catch (e) {
        if (e.code === 11000) return res.status(400).json({ error: 'El número de parte ya existe.' });
        res.status(500).json({ error: 'Error actualizando el ítem.' });
    }
});

app.delete('/api/inventory/:id', async (req, res) => {
    try {
        const deletedItem = await InventoryItem.findByIdAndDelete(req.params.id);
        if (!deletedItem) return res.status(404).json({ error: 'Item no encontrado.' });
        
        io.emit('delete_inventory_item', req.params.id);
        res.json({ message: 'Ítem eliminado correctamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando del inventario.' });
    }
});

app.post('/api/inventory/:id/report-broken', async (req, res) => {
    try {
        const { id } = req.params;
        const { cantidad, reportadoPor, falla, enCampo } = req.body;
        
        const cant = parseInt(cantidad) || 1;

        const item = await InventoryItem.findById(id);
        if (!item) return res.status(404).json({ error: 'Item no encontrado.' });
        
        if (!enCampo) {
            if (item.cantidadEnStock < cant) {
                 return res.status(400).json({ error: 'No hay suficiente stock para marcar esta cantidad como descompuesta.' });
            }
            item.cantidadEnStock -= cant;
            item.cantidadDescompuesta += cant;
        }

        item.historialFallas.push({
             reportadoPor: reportadoPor || 'Desconocido',
             falla: falla || 'Sin descripción',
             cantidad: cant,
             fecha: new Date(),
             solucionado: false,
             enCampo: !!enCampo
        });
        
        await item.save();
        
        const responseObj = { ...item.toObject(), id: item._id.toString() };
        io.emit('update_inventory_item', responseObj);
        res.status(200).json({ message: 'Falla reportada con éxito.', item: responseObj });
    } catch (e) {
        console.error("Error reportando falla", e);
        res.status(500).json({ error: 'Error reportando la falla.' });
    }
});

app.post('/api/inventory/:id/repair', async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId, fallaId } = req.body;
        
        const adminUser = await User.findById(adminId);
        if (!adminUser || adminUser.rol !== 'admin') {
             return res.status(403).json({ error: 'Solo los administradores pueden marcar herramientas como reparadas.' });
        }
        
        const item = await InventoryItem.findById(id);
        if (!item) return res.status(404).json({ error: 'Item no encontrado.' });
        
        const incident = item.historialFallas.id(fallaId);
        if (!incident) return res.status(404).json({ error: 'Incidente no encontrado.' });
        if (incident.solucionado) return res.status(400).json({ error: 'El incidente ya fue solucionado.' });
        
        incident.solucionado = true;
        incident.fechaSolucion = new Date();
        
        const cantToRepair = incident.cantidad || 1;
        
        if (!incident.enCampo) {
            item.cantidadDescompuesta -= cantToRepair;
            item.cantidadEnStock += cantToRepair;
            if (item.cantidadDescompuesta < 0) item.cantidadDescompuesta = 0;
        }
        
        await item.save();
        
        const responseObj = { ...item.toObject(), id: item._id.toString() };
        io.emit('update_inventory_item', responseObj);
        res.status(200).json({ message: 'Herramienta marcada como reparada.', item: responseObj });
    } catch (e) {
        console.error("Error reparando falla", e);
        res.status(500).json({ error: 'Error marcando como reparada.' });
    }
});

app.post('/api/inventory/transaction', async (req, res) => {
    try {
        const { tipoMovimiento, responsable, firma } = req.body;
        // Support both old format { itemId, cantidad } and new array format { items: [{itemId, cantidad}] }
        let itemsArr = req.body.items;
        if (!itemsArr && req.body.itemId && req.body.cantidad) {
            itemsArr = [{ itemId: req.body.itemId, cantidad: req.body.cantidad }];
        }
        
        if (!itemsArr || !itemsArr.length || !tipoMovimiento || !responsable || !firma) {
            return res.status(400).json({ error: 'Faltan datos de la transacción (firma, artículos, responsable).' });
        }
        
        // 1. Initial Validation of all items
        const itemDocs = [];
        const quantities = [];
        for (let i = 0; i < itemsArr.length; i++) {
            const { itemId, cantidad } = itemsArr[i];
            const cant = parseInt(cantidad) || 0;
            if (cant <= 0) return res.status(400).json({ error: 'Cantidad inválida para uno de los artículos.' });
            
            const item = await InventoryItem.findById(itemId);
            if (!item) return res.status(404).json({ error: `Ítem no encontrado (ID: ${itemId}).` });
            
            if (tipoMovimiento === 'Salida' && item.cantidadEnStock < cant) {
                return res.status(400).json({ error: `Stock insuficiente para la salida del artículo: ${item.nombre}.` });
            }
            if (tipoMovimiento !== 'Salida' && tipoMovimiento !== 'Devolucion' && tipoMovimiento !== 'Entrada') {
                return res.status(400).json({ error: 'Tipo de movimiento inválido.' });
            }
            itemDocs.push(item);
            quantities.push(cant);
        }
        
        // 2. Perform updates and create transactions
        const responseItems = [];
        for (let i = 0; i < itemDocs.length; i++) {
            const item = itemDocs[i];
            const cant = quantities[i];
            
            if (tipoMovimiento === 'Salida') {
                item.cantidadEnStock -= cant;
            } else {
                item.cantidadEnStock += cant;
            }
            
            await item.save();
            
            const transaction = new InventoryTransaction({
                itemId: item._id, tipoMovimiento, cantidad: cant, responsable, firma
            });
            await transaction.save();
            
            const formattedItem = { ...item.toObject(), id: item._id.toString() };
            responseItems.push(formattedItem);
            io.emit('update_inventory_item', formattedItem);
        }
        
        io.emit('inventory_transactions_updated', { responsable });
        
        res.status(201).json({ message: 'Transacción multi-ítem guardada con éxito.', items: responseItems });
    } catch (e) {
        console.error("error tx", e);
        res.status(500).json({ error: 'Error procesando la transacción multi-ítem.' });
    }
});

app.get('/api/inventory/:id/transactions', async (req, res) => {
    try {
        const transactions = await InventoryTransaction.find({ itemId: req.params.id }).sort({ fecha: -1 });
        res.json(transactions);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial.' });
    }
});

app.get('/api/inventory/loans/:responsable', async (req, res) => {
    try {
        const { responsable } = req.params;
        // Match the exact string of the selected user or entered "OTRO" name
        const transactions = await InventoryTransaction.find({ responsable: responsable }).populate('itemId');
        
        const countMap = {};
        for (const t of transactions) {
            if (t.itemId) {
                const idStr = t.itemId._id.toString();
                if (!countMap[idStr]) {
                    countMap[idStr] = {
                        item: { 
                            id: idStr, 
                            nombre: t.itemId.nombre, 
                            numeroParte: t.itemId.numeroParte,
                            tipo: t.itemId.tipo,
                            cantidadEnStock: t.itemId.cantidadEnStock
                        },
                        cantidad: 0 // Net loaned quantity
                    };
                }
                if (t.tipoMovimiento === 'Salida') countMap[idStr].cantidad += t.cantidad;
                else if (t.tipoMovimiento === 'Devolucion') countMap[idStr].cantidad -= t.cantidad;
            }
        }
        
        const activeLoans = Object.values(countMap).filter(v => v.cantidad > 0);
        res.json(activeLoans);
    } catch (e) {
        console.error("Error obteniendo prestamos: ", e);
        res.status(500).json({ error: 'Error obteniendo préstamos activos.' });
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
