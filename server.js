const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuración Gemini (Para auto-programación de IA)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.api_gemini;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Configuración Web Push (VAPID)
const VAPID_PUBLIC_KEY = 'BJvKenaUsLTNY_QxgZy1Md3kIiRVNCS05ql5F5mrdgPYZY5A9xyYeeuraXFGrNnVtvG--hFJLM0qWKKUdmboYEU';
const VAPID_PRIVATE_KEY = 'qMSDE_bohcrQBpKhYRXJ_Zb80eRuSOnx4dK9PmxUsEQ';
webpush.setVapidDetails('mailto:soporte@naisata.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);


// --- IT Console Log Interceptor ---
const MAX_LOG_LINES = 100;
const serverLogs = [];

function addLogLine(level, ...args) {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    serverLogs.push(`[${timestamp}] [${level}] ${message}`);
    if (serverLogs.length > MAX_LOG_LINES) {
        serverLogs.shift();
    }
}

const originalLog = console.log;
const originalError = console.error;

console.log = function (...args) {
    addLogLine('INFO', ...args);
    originalLog.apply(console, args);
};

console.error = function (...args) {
    addLogLine('ERROR', ...args);
    originalError.apply(console, args);
};
// ----------------------------------

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
    fechaIngreso: { type: Date, default: () => new Date(new Date().getFullYear(), 0, 1) },
    fechaReinicioAsistencia: { type: Date },
    fotoPerfil: { type: String, default: '' },
    terminosAceptados: { type: Boolean, default: false },
    evidenciaTerminos: { type: String, default: '' },
    estadoCuenta: { type: String, enum: ['pendiente', 'activa', 'rechazada', 'inactiva'] },
    numeroEmpleado: { type: Number, unique: true, sparse: true },
    faceDescriptor: { type: [Number], default: [] },
    rfc: { type: String, default: '' },
    nss: { type: String, default: '' },
    documentos: [{
        nombre: String,
        url: String,
        fecha: { type: Date, default: Date.now }
    }]
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const AdminAuditLogSchema = new mongoose.Schema({
    adminCorreo: String,
    action: String,
    details: String,
    timestamp: { type: Date, default: Date.now }
});
const AdminAuditLog = mongoose.model('AdminAuditLog', AdminAuditLogSchema);

const BugReportSchema = new mongoose.Schema({
    userCorreo: String,
    description: String,
    status: { type: String, default: 'pendiente' },
    timestamp: { type: Date, default: Date.now }
});
const BugReport = mongoose.model('BugReport', BugReportSchema);

async function logAdminAction(adminCorreo, action, details) {
    try {
        await AdminAuditLog.create({ adminCorreo, action, details });
    } catch (e) { console.error("Error logging admin action:", e); }
}


// --- In-Memory Cache System (5 seconds TTL) ---
const AppCache = {
    cache: {},
    get: function (key) {
        if (this.cache[key] && Date.now() < this.cache[key].exp) return this.cache[key].data;
        return null;
    },
    set: function (key, data, ttlMs = 5000) {
        this.cache[key] = { data, exp: Date.now() + ttlMs };
    },
    clear: function (key) {
        if (key) delete this.cache[key];
        else this.cache = {};
    }
};

// Run migration to assure numeroEmpleado
async function asegurarNumeroEmpleado() {
    try {
        const usersSinNumero = await User.find({ numeroEmpleado: { $exists: false } }).select('_id').sort({ createdAt: 1 });
        if (usersSinNumero.length === 0) return;

        let maxEmpleado = await User.findOne({ numeroEmpleado: { $exists: true } }).sort({ numeroEmpleado: -1 });
        let nextNumber = maxEmpleado && maxEmpleado.numeroEmpleado ? maxEmpleado.numeroEmpleado + 1 : 101;

        for (const u of usersSinNumero) {
            u.numeroEmpleado = nextNumber++;
            await u.save();
        }
        console.log(`Migración completada. Se asignaron ${usersSinNumero.length} números de empleado.`);
    } catch (e) {
        console.error('Error en migración numeroEmpleado:', e);
    }
}
asegurarNumeroEmpleado();

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

const AvisoSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    mensaje: { type: String, required: true },
    imagen: { type: String, default: '' },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, required: true },
    activo: { type: Boolean, default: true },
    requiereActualizacion: { type: Boolean, default: false }
}, { timestamps: true });
const Aviso = mongoose.model('Aviso', AvisoSchema);

// --- AI Evolutiva (El Cerebro) ---
const AiRuleSchema = new mongoose.Schema({
    triggerKeyword: String, // ej. "CABLE UTP"
    targetKeyword: String, // ej. "TUBO CONDUIT"
    confidence: { type: Number, default: 0.5 }, // Confianza (0.0 a 1.0)
    codeFormula: { type: String, default: "return triggerQty;" }, // Fórmula JS evaluable
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    lastEvolvedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
});
const AiRule = mongoose.model('AiRule', AiRuleSchema);

const AiLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    eventType: String,
    details: String,
    prompt: String,
    response: String,
    oldCode: String,
    newCode: String
});
const AiLog = mongoose.model('AiLog', AiLogSchema);

const NotificationSchema = new mongoose.Schema({
    userId: { type: String, required: true }, // Puede ser el ID de usuario o los strings especiales 'all', 'admins'
    titulo: { type: String, required: true },
    mensaje: { type: String, required: true },
    leido: { type: Boolean, default: false },
    data: { type: mongoose.Schema.Types.Mixed, default: {} } // Para futura navegación de módulos
}, { timestamps: true });
const NotificationModel = mongoose.model('Notification', NotificationSchema);

const PushSubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    role: { type: String, default: 'normal' },
    subscription: { type: Object, required: true }
}, { timestamps: true });
const PushSubscription = mongoose.model('PushSubscription', PushSubscriptionSchema);

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
    tipo: { type: String, enum: ['Entrada', 'Salida', 'Salida Comida', 'Entrada Comida'], required: true },
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
CheckInSchema.index({ userId: 1, timestamp: -1 });
UserSchema.index({ rol: 1 });
UserSchema.index({ estadoCuenta: 1 });

const Ticket = mongoose.model('Ticket', TicketSchema);
const CheckIn = mongoose.model('CheckIn', CheckInSchema);
const VacationRequest = mongoose.model('VacationRequest', VacationRequestSchema);

const ProjectSchema = new mongoose.Schema({
    tipo: { type: String, enum: ['General', 'Cableado'], default: 'General' },
    nombre: String,
    descripcion: String,
    clienteId: String,
    presupuestoMateriales: { type: Number, default: 0 },
    presupuestoEstimado: { type: Number, default: 0 }, // Presupuesto de referencia
    estado: { type: String, enum: ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Activo', 'Pausado', 'Finalizado'], default: 'Borrador' },
    residenteId: String,
    ubicacion: String
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

const InternalMessageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    receiverId: { type: String, required: true },
    receiverName: { type: String, required: true },
    subject: { type: String, default: 'Sin Asunto' },
    body: { type: String, default: '' },
    status: { type: String, enum: ['borrador', 'enviado'], default: 'enviado' },
    isRead: { type: Boolean, default: false },
    attachments: [{
        nombre: String,
        url: String, // Base64
        tipo: String // 'image/png', 'application/pdf', etc.
    }]
}, { timestamps: true });
const InternalMessage = mongoose.model('InternalMessage', InternalMessageSchema);

const InventoryItemSchema = new mongoose.Schema({
    cantidadEnStock: { type: Number, default: 0 },
    unidad: { type: String, enum: ['piezas', 'metros'], default: 'piezas' },
    tipo: { type: String, enum: ['Insumo', 'Herramienta'], required: true },
    nombre: { type: String, required: true },
    categoria: { type: String, default: '' },
    numeroParte: { type: String, required: true, unique: true },
    marca: { type: String, default: '' },
    ubicacion: { type: String, default: '' },
    costoUnitario: { type: Number, default: 0 },
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

const VehicleTransactionSchema = new mongoose.Schema({
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    userId: { type: String, required: false },
    userName: { type: String, required: false },
    tipoMovimiento: { type: String, enum: ['Salida', 'Devolucion', 'Devolución', 'Préstamo', 'Gasolina', 'Mantenimiento'], required: true },
    responsable: { type: String, required: false },
    proyectoId: { type: String, required: false }, // Asociar a un proyecto
    motivo: { type: String, required: false },
    kilometraje: { type: Number, required: false },
    firma: { type: String, required: false }, // Base64
    firmaUsuario: { type: String, required: false }, // Base64
    notas: { type: String, required: false },
    bitacoraRevisada: { type: [String], default: [] },
    imgReporteDanos: { type: String, required: false },
    estadoConfirmacion: { type: String, enum: ['Confirmado', 'Pendiente', 'Rechazado'], default: 'Confirmado' },
    checklist: {
        aceite: { type: Boolean, default: true },
        llantas: { type: Boolean, default: true },
        limpieza: { type: Boolean, default: true },
        documentos: { type: Boolean, default: true }
    },
    checklistNotas: { type: String, default: '' },
    gasolinaMonto: { type: Number, default: 0 },
    gasolinaLitros: { type: Number, default: 0 },
    gasolinaFoto: { type: String, default: '' },
    mantenimientoCosto: { type: Number, default: 0 },
    mantenimientoPiezas: { type: String, default: '' },
    mantenimientoTaller: { type: String, default: '' },
    inspeccionPreviaje: { type: Object, default: {} },
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });
VehicleTransactionSchema.index({ vehicleId: 1, fecha: -1 });
const VehicleTransaction = mongoose.model('VehicleTransaction', VehicleTransactionSchema);

const DamageReportSchema = new mongoose.Schema({
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    reportadoPor: { type: String, required: true },
    observaciones: { type: String, required: true },
    coordenadasCarroceria: [{
        x: Number,
        y: Number,
        tipo: String // e.g., 'raya', 'golpe', 'roto'
    }],
    fotosEvidencia: [String], // Array de Base64 o URLs
    fecha: { type: Date, default: Date.now },
    firma: { type: String, required: true }
}, { timestamps: true });
const DamageReport = mongoose.model('DamageReport', DamageReportSchema);

const PersonalEquipmentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    equipmentName: { type: String, required: true },
    serialNumber: { type: String, default: '' },
    notes: { type: String, default: '' },
    estado: { type: String, enum: ['Pendiente', 'Aceptado', 'Rechazado'], default: 'Pendiente' },
    isMissing: { type: Boolean, default: false },
    missingReportedAt: { type: Date }
}, { timestamps: true });
const PersonalEquipment = mongoose.model('PersonalEquipment', PersonalEquipmentSchema);

// --- Helpers de Notificación Web Push ---

const VehicleSchema = new mongoose.Schema({
    marca: { type: String, required: true },
    modelo: { type: String, required: true },
    color: { type: String, required: true },
    placas: { type: String, required: true, unique: true },
    estado: { type: String, enum: ['Disponible', 'Prestado', 'Mantenimiento', 'Pendiente de Confirmación'], default: 'Disponible' },
    bitacoraEsperada: { type: [String], default: ['Gato', 'Refacción', 'Cables auxiliares', 'Extintor'] },
    equipmentPhotos: { type: [String], default: [] },
    documentosVehiculo: { type: [String], default: [] },
    lastDamageReport: { type: String, default: '' },
    currentUserId: { type: String, default: null },
    currentUserName: { type: String, default: null },
    encendido: { type: Boolean, default: false },
    kilometrajeActual: { type: Number, default: 0 },
    proximoServicioKm: { type: Number, default: 10000 },
    vencimientoSeguro: { type: Date, default: null },
    vencimientoVerificacion: { type: Date, default: null },
    imei: { type: String, default: '' },
    flespiId: { type: String, default: '' },
    lastLocation: { type: Object, default: null },
    locationHistory: { type: [Object], default: [] },
    currentStopId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

const VehicleRoutePointSchema = new mongoose.Schema({
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    lat: Number,
    lng: Number,
    speed: Number,
    ignition: Boolean,
    timestamp: { type: Date, default: Date.now, expires: '7d' }
});
const VehicleRoutePoint = mongoose.model('VehicleRoutePoint', VehicleRoutePointSchema);

const VehicleStopSchema = new mongoose.Schema({
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    userId: { type: String, default: null },
    userName: { type: String, default: null },
    lat: Number,
    lng: Number,
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    durationMinutes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: '7d' }
});
const VehicleStop = mongoose.model('VehicleStop', VehicleStopSchema);

const InventoryTransactionSchema = new mongoose.Schema({
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    tipoMovimiento: { type: String, enum: ['Salida', 'Devolucion', 'Entrada'], required: true },
    cantidad: { type: Number, required: true },
    responsable: { type: String, required: true },
    proyectoId: { type: String, required: false },
    costoTotal: { type: Number, default: 0 },
    firma: { type: String, required: false }, // Base64
    estadoConfirmacion: { type: String, enum: ['Confirmado', 'Pendiente', 'Rechazado'], default: 'Confirmado' },
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });
InventoryTransactionSchema.index({ itemId: 1, fecha: -1 });
InventoryTransactionSchema.index({ responsable: 1 });
const InventoryTransaction = mongoose.model('InventoryTransaction', InventoryTransactionSchema);

const HelpRequestSchema = new mongoose.Schema({
    requesterId: { type: String, required: true },
    requesterName: { type: String, required: true },
    assignedToId: { type: String, required: true },
    assignedToName: { type: String, required: true },
    description: { type: String, required: true },
    targetDate: { type: String, required: true },
    status: { type: String, enum: ['pendiente', 'confirmado', 'resuelto'], default: 'pendiente' }
}, { timestamps: true });
const HelpRequest = mongoose.model('HelpRequest', HelpRequestSchema);

async function calcularVacacionesDinamicamente(user) {
    if (!user) return 0;

    // Prioridad Absoluta: Si la DB tiene días cargados manualmente (ej. por admin antiguo/forzoso), sobrescriben TODO.
    if (user.diasVacacionesDisponibles !== undefined && user.diasVacacionesDisponibles > 0) {
        // Necesitamos calcular consumidos para no mentir
        const hoy = new Date();
        const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
        const solicitudesConsumidas = await VacationRequest.find({
            userId: user._id.toString(),
            estado: 'aprobada',
            fechaInicio: { $gte: inicioAnio }
        });
        const consumidos = solicitudesConsumidas.reduce((acc, curr) => acc + curr.diasSolicitados, 0);
        return Math.max(0, user.diasVacacionesDisponibles - consumidos);
    }

    // Fallback si no tiene fechaIngreso en DB (cuenta súper vieja)
    const fechaReal = user.fechaIngreso ? new Date(user.fechaIngreso) : new Date(new Date().getFullYear(), 0, 1);

    const hoy = new Date();
    const ingreso = fechaReal;
    let aniosAntiguedad = hoy.getFullYear() - ingreso.getFullYear();
    const mesHoy = hoy.getMonth();
    const diaHoy = hoy.getDate();
    const mesIngreso = ingreso.getMonth();
    const diaIngreso = ingreso.getDate();

    // Ajustar si aún no cumple años de aniversario laboral
    if (mesHoy < mesIngreso || (mesHoy === mesIngreso && diaHoy < diaIngreso)) {
        aniosAntiguedad--;
    }

    // Calcular el inicio del ciclo vacacional actual para contar consumos desde ahí
    let cicloActualInicio = new Date(ingreso);
    cicloActualInicio.setFullYear(ingreso.getFullYear() + aniosAntiguedad);

    let diasBase = 0;
    const diffMeses = (hoy.getFullYear() - ingreso.getFullYear()) * 12 + (hoy.getMonth() - ingreso.getMonth());
    const exactDiffMeses = diffMeses - (hoy.getDate() < ingreso.getDate() ? 1 : 0);

    if (aniosAntiguedad < 1) {
        if (exactDiffMeses >= 6) {
            diasBase = 6;
            cicloActualInicio = new Date(ingreso);
            cicloActualInicio.setMonth(ingreso.getMonth() + 6);
        } else {
            diasBase = 0;
        }
    } else if (aniosAntiguedad === 1) {
        diasBase = 12;
    } else {
        diasBase = 12 + ((aniosAntiguedad - 1) * 2);
    }

    if (diasBase === 0) return 0;

    const solicitudesConsumidas = await VacationRequest.find({
        userId: user._id.toString(),
        estado: 'aprobada',
        fechaInicio: { $gte: cicloActualInicio }
    });
    const consumidos = solicitudesConsumidas.reduce((acc, curr) => acc + curr.diasSolicitados, 0);
    return Math.max(0, diasBase - consumidos);
}

// --- Helper Functions para Estadisticas y Asistencia ---
// --- Global Helper para Feriados ---
const isHoliday = (dateStr) => {
    const [y, m, d] = dateStr.split('-');
    const year = parseInt(y);

    if (!isHoliday.cache) isHoliday.cache = {};
    if (!isHoliday.cache[year]) {
        const holidays = [];
        holidays.push(`${year}-01-01`); // Año Nuevo

        const getFirstMonday = (yr, mo) => {
            let dt = new Date(yr, mo, 1);
            while (dt.getDay() !== 1) { dt.setDate(dt.getDate() + 1); }
            return dt;
        };
        const getNthMonday = (yr, mo, n) => {
            let dt = getFirstMonday(yr, mo);
            dt.setDate(dt.getDate() + (n - 1) * 7);
            return dt;
        };

        const febHoliday = getNthMonday(year, 1, 1);
        holidays.push(`${year}-02-${String(febHoliday.getDate()).padStart(2, '0')}`); // Día Constitución

        const marHoliday = getNthMonday(year, 2, 3);
        holidays.push(`${year}-03-${String(marHoliday.getDate()).padStart(2, '0')}`); // Natalicio Benito Juárez

        holidays.push(`${year}-05-01`); // Día del Trabajo
        holidays.push(`${year}-09-16`); // Independencia

        if ((year - 2024) % 6 === 0) {
            holidays.push(`${year}-10-01`); // Transmisión poder
        }

        const novHoliday = getNthMonday(year, 10, 3);
        holidays.push(`${year}-11-${String(novHoliday.getDate()).padStart(2, '0')}`); // Revolución

        holidays.push(`${year}-12-25`); // Navidad

        isHoliday.cache[year] = holidays;
    }
    return isHoliday.cache[year].includes(dateStr);
};

async function calcularEstadisticasAsistenciaUsuario(user) {
    const userId = user._id ? user._id.toString() : user.id;
    const settings = await Settings.findOne({ tipo: 'timeclock' });
    const globalHorarios = settings ? settings.horariosPorDia : [];
    const globalTolerancia = settings ? Number(settings.toleranciaMinutos) || 15 : 15;

    const checkins = await CheckIn.find({ userId }).sort({ timestamp: 1 });
    const vacaciones = await VacationRequest.find({ userId, estado: 'aprobada' });

    let faltasTotales = 0;
    let retardosTotales = 0;
    let diasFalta = [];
    let diasRetardo = [];

    const isVacation = (dateStr) => {
        return vacaciones.some(v => {
            const startStr = new Date(v.fechaInicio).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            const endStr = new Date(v.fechaFin).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            return dateStr >= startStr && dateStr <= endStr;
        });
    };



    const checkinsPorDia = {};
    checkins.forEach(c => {
        const d = new Date(c.timestamp);
        const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        if (!checkinsPorDia[dateStr]) checkinsPorDia[dateStr] = [];
        checkinsPorDia[dateStr].push(c);
    });

    const checkinDatesStr = new Set(Object.keys(checkinsPorDia));
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);

    let startTrackingDate = user.fechaReinicioAsistencia ? new Date(user.fechaReinicioAsistencia) : (user.fechaIngreso ? new Date(user.fechaIngreso) : new Date(hoy.getFullYear(), 0, 1));
    startTrackingDate.setHours(0, 0, 0, 0);

    let iterDate = new Date(startTrackingDate);
    while (iterDate <= hoy) {
        // Normalizar iterDate al mediodía para evitar saltos de día por zona horaria
        iterDate.setHours(12, 0, 0, 0);
        const tsStr = iterDate.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

        // Calcular el día de la semana basado en la fecha local de CDMX
        const dayOfWeek = new Date(iterDate.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })).getDay();

        let horarioDia = (user.usaHorarioPersonalizado && user.horariosPorDia)
            ? user.horariosPorDia.find(h => h.dia === dayOfWeek)
            : globalHorarios.find(h => h.dia === dayOfWeek);

        if (horarioDia && horarioDia.activo && horarioDia.entrada && !isVacation(tsStr) && !isHoliday(tsStr)) {
            if (!checkinDatesStr.has(tsStr)) {
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                if (iterDate < todayMidnight) {
                    faltasTotales++;
                    diasFalta.push(tsStr);
                }
            } else {
                const entradasDelDia = checkinsPorDia[tsStr].filter(c => c.tipo && c.tipo.trim() === 'Entrada');
                if (entradasDelDia.length > 0) {
                    const primeraEntrada = entradasDelDia[0];
                    const d = new Date(primeraEntrada.timestamp);
                    const [h, m] = horarioDia.entrada.split(':').map(Number);
                    const expectedMinutes = h * 60 + m;

                    const mxTime = d.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false });
                    const [actualH, actualM] = mxTime.split(':').map(Number);
                    const actualMinutes = actualH * 60 + actualM;

                    if (actualMinutes > (expectedMinutes + globalTolerancia)) {
                        retardosTotales++;
                        diasRetardo.push(tsStr);
                    }
                } else {
                    const todayMidnight = new Date();
                    todayMidnight.setHours(0, 0, 0, 0);
                    if (iterDate < todayMidnight) {
                        faltasTotales++;
                        diasFalta.push(tsStr);
                    }
                }
            }
        }
        iterDate.setDate(iterDate.getDate() + 1);
    }

    if (user.rol === 'socio') {
        faltasTotales = 0;
        retardosTotales = 0;
        diasFalta = [];
        diasRetardo = [];
    }

    return {
        faltasTotales,
        retardosTotales,
        diasFalta,
        diasRetardo,
        checkinsPorDia
    };
}

// --- Helper Functions para Web Push ---
async function sendPushNotification(subscription, payload) {
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
            await PushSubscription.deleteOne({ 'subscription.endpoint': subscription.endpoint });
        } else {
            console.error('Error enviando push:', e);
        }
    }
}

async function persistNotification(userId, payload) {
    try {
        const notif = new NotificationModel({
            userId: userId,
            titulo: payload.title || 'Notificación',
            mensaje: payload.body || '',
            data: payload.data || {}
        });
        await notif.save();
        // Emit in real-time
        if (typeof io !== 'undefined') {
            io.emit('new_in_app_notification', { userId: userId });
        }
    } catch (e) {
        console.error('Error guardando notificación en BD:', e);
    }
}

async function notifyAdmins(payload) {
    await persistNotification('admins', payload);
    const adminSubs = await PushSubscription.find({ role: 'admin' });
    for (const sub of adminSubs) {
        await sendPushNotification(sub.subscription, payload);
    }
}

async function notifyUser(userId, payload) {
    await persistNotification(userId, payload);
    const userSubs = await PushSubscription.find({ userId });
    for (const sub of userSubs) {
        await sendPushNotification(sub.subscription, payload);
    }
}

async function notifyAll(payload) {
    await persistNotification('all', payload);
    const allSubs = await PushSubscription.find({});
    for (const sub of allSubs) {
        await sendPushNotification(sub.subscription, payload);
    }
}

async function notifyUserByName(fullName, payload) {
    const users = await User.find({}).select('_id nombre apellido horariosPorDia usaHorarioPersonalizado');
    const targetUser = users.find(u => `${u.nombre} ${u.apellido}`.trim().toLowerCase() === fullName.trim().toLowerCase());
    if (targetUser) {
        await notifyUser(targetUser._id.toString(), payload);
    }
}

// CORS Update para permitir solicitudes desde el front hospedado en otro sitio
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Exponer la carpeta de subidas en la raíz

// --- Advanced IT Suite ---
let globalMaintenanceMode = false;
const activeSocketsMap = {};

app.use((req, res, next) => {
    if (globalMaintenanceMode) {
        if (!req.path.startsWith('/api/login') && !req.path.startsWith('/api/it/')) {
            return res.status(503).json({ error: 'MAINTENANCE_MODE', message: 'Sistema en mantenimiento crítico' });
        }
    }
    next();
});

app.post('/api/it/maintenance', (req, res) => {
    globalMaintenanceMode = req.body.active;
    io.emit('maintenance_active', globalMaintenanceMode);
    logAdminAction('daniel@naisata.com', 'TOGGLE_MAINTENANCE', `Mantenimiento: ${globalMaintenanceMode}`);
    res.json({ maintenance: globalMaintenanceMode });
});

app.get('/api/it/logs', (req, res) => {
    res.json(serverLogs);
});

app.get('/api/it/backup', async (req, res) => {
    try {
        const users = await User.find({});
        const checkins = await mongoose.model('CheckIn').find({});
        const vacations = await mongoose.model('VacationRequest').find({});
        const vehicles = await mongoose.model('VehicleTransaction').find({});
        const helps = await mongoose.model('HelpRequest').find({});

        const backupData = {
            timestamp: new Date(),
            users, checkins, vacations, vehicles, helps
        };
        logAdminAction('daniel@naisata.com', 'DOWNLOAD_BACKUP', 'Se generó un respaldo JSON global');
        res.json(backupData);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/it/active-users', (req, res) => {
    res.json(activeSocketsMap);
});

app.post('/api/it/disconnect-user', (req, res) => {
    const { socketId } = req.body;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
        socket.emit('force_logout', 'Desconectado remotamente por el administrador');
        socket.disconnect(true);
        logAdminAction('daniel@naisata.com', 'KICK_USER', `Expulsó al socket ${socketId}`);
        res.json({ message: 'Usuario desconectado exitosamente' });
    } else {
        res.status(404).json({ error: 'Socket no encontrado o ya desconectado' });
    }
});

app.get('/api/it/audit-logs', async (req, res) => {
    const logs = await mongoose.model('AdminAuditLog').find({}).sort({ timestamp: -1 }).limit(200);
    res.json(logs);
});

app.get('/api/it/bug-reports', async (req, res) => {
    const bugs = await mongoose.model('BugReport').find({}).sort({ timestamp: -1 });
    res.json(bugs);
});

app.post('/api/bug-report', async (req, res) => {
    try {
        const { correo, description } = req.body;
        const bug = new (mongoose.model('BugReport'))({ userCorreo: correo, description });
        await bug.save();
        res.json({ message: 'Reporte de bug enviado correctamente' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
// -------------------------


// --- Endpoints Notificaciones Web Push ---
app.post('/api/inapp-notifs/subscribe', async (req, res) => {
    try {
        const { userId, role, subscription } = req.body;
        if (!userId || !subscription) return res.status(400).json({ error: 'Faltan parámetros' });

        await PushSubscription.findOneAndUpdate(
            { 'subscription.endpoint': subscription.endpoint }, // Si el endpoint existe, actualízalo
            { userId, role, subscription },
            { upsert: true, returnDocument: 'after' }
        );
        res.status(201).json({ message: 'Suscrito con éxito' });
    } catch (e) {
        console.error('Error suscribiendo a push:', e);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener Notificaciones In-App
app.get('/api/inapp-notifs/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.query; // Para obtener también las globales si es admin

        let queryIds = [userId, 'all'];
        if (role === 'admin') {
            queryIds.push('admins');
        }

        const notifications = await NotificationModel.find({ userId: { $in: queryIds } })
            .sort({ createdAt: -1 })
            .limit(50); // Cargar las últimas 50

        res.json(notifications);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo notificaciones.' });
    }
});

// Marcar notificación como leída
app.put('/api/inapp-notifs/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await NotificationModel.findByIdAndUpdate(id, { leido: true });
        res.json({ message: 'Notificación leída.' });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando notificación.' });
    }
});

// Marcar TODAS como leídas
app.put('/api/inapp-notifs/read-all/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        let queryIds = [userId, 'all'];
        if (role === 'admin') {
            queryIds.push('admins');
        }
        await NotificationModel.updateMany({ userId: { $in: queryIds }, leido: false }, { leido: true });
        res.json({ message: 'Todas leídas.' });
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando notificaciones.' });
    }
});

// 1. Registro (Register)
app.post('/api/register', async (req, res) => {
    try {
        const { nombre, apellido, correo, telefono, password, firma, fotoPerfil, fechaIngreso } = req.body;

        if (!nombre || !apellido || !correo || !telefono || !password || !firma || !fotoPerfil) {
            return res.status(400).json({ error: 'Todos los campos, foto de perfil y la firma son requeridos.' });
        }

        const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!pwdRegex.test(password)) {
            return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres, e incluir al menos una mayúscula, una minúscula, un número y un signo especial.' });
        }

        if (!correo.endsWith('@naisata.com')) {
            return res.status(403).json({ error: 'Acceso denegado. Correo no autorizado.' });
        }

        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado.' });
        }

        let maxEmpleado = await User.findOne({ numeroEmpleado: { $exists: true } }).sort({ numeroEmpleado: -1 });
        let nextNumber = maxEmpleado && maxEmpleado.numeroEmpleado ? maxEmpleado.numeroEmpleado + 1 : 101;

        const newUser = new User({
            nombre, apellido, correo, telefono, password, firma, fotoPerfil,
            fechaIngreso: fechaIngreso || new Date(),
            estadoCuenta: 'pendiente',
            numeroEmpleado: nextNumber
        });
        await newUser.save();

        notifyAdmins({
            title: "Nueva Solicitud de Cuenta",
            body: `${nombre} ${apellido} ha solicitado crear una cuenta. Requiere tu aprobación.`
        });

        res.status(201).json({ message: 'Usuario registrado. Pendiente de aprobación.', user: newUser });
    } catch (e) {
        res.status(500).json({ error: 'Error interno guardando el usuario.' });
    }
});

// 1.2 Obtener Usuarios (Para Admin)
app.get('/api/users', async (req, res) => {
    try {
        const cached = AppCache.get('usersAdminList');
        if (cached) return res.json(cached);

        const users = await User.find().select('-password -firma -faceDescriptor -fotoPerfil -evidenciaTerminos').sort({ createdAt: -1 });
        const usersData = [];
        for (const user of users) {
            const diasCalc = await calcularVacacionesDinamicamente(user);
            const userObj = user.toObject();
            userObj.diasVacacionesDisponibles = diasCalc;
            usersData.push(userObj);
        }
        AppCache.set('usersAdminList', usersData, 5000); // 5 seconds TTL
        res.json(usersData);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo usuarios.' });
    }
});

// 1.2.0 Obtener Usuarios Pendientes de Aprobación
app.get('/api/users/faces', async (req, res) => {
    try {
        const users = await User.find({ faceDescriptor: { $exists: true, $ne: [] } }, 'nombre apellido faceDescriptor');
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching faces' });
    }
});

app.get('/api/users/pending', async (req, res) => {
    try {
        const pendingUsers = await User.find({ estadoCuenta: 'pendiente' }).select('-password -firma -faceDescriptor -fotoPerfil -evidenciaTerminos').sort({ createdAt: -1 });
        res.json(pendingUsers);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo solicitudes de cuenta.' });
    }
});

// 1.2.0.1 Aprobar o Rechazar Solicitud de Cuenta
app.put('/api/users/:id/approve-registration', async (req, res) => {
    try {
        const { rol, fechaIngreso } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (user.estadoCuenta !== 'pendiente') return res.status(400).json({ error: 'La cuenta no está en estado pendiente.' });

        user.estadoCuenta = 'activa';
        user.rol = rol || 'user';
        if (fechaIngreso) {
            user.fechaIngreso = new Date(fechaIngreso);
        }
        await user.save();
        res.json({ message: 'Cuenta aprobada exitosamente', user });
    } catch (e) {
        res.status(500).json({ error: 'Error aprobando cuenta.' });
    }
});

app.delete('/api/users/:id/reject-registration', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (user.estadoCuenta !== 'pendiente') return res.status(400).json({ error: 'Solo puedes rechazar cuentas pendientes.' });

        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'Cuenta rechazada y eliminada del sistema.' });
    } catch (e) {
        res.status(500).json({ error: 'Error rechazando cuenta.' });
    }
});

// 1.2.1 Obtener Usuario Específico
app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -firma');
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const userObj = user.toObject();
        userObj.diasVacacionesDisponibles = await calcularVacacionesDinamicamente(user);
        res.json(userObj);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo al usuario.' });
    }
});

// 1.2.2 Obtener Estadísticas de Empleado (Dashboard)
app.get('/api/users/:id/dashboard-stats', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId).select('nombre apellido diasVacacionesDisponibles horariosPorDia usaHorarioPersonalizado rol fechaIngreso fechaReinicioAsistencia');
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const nombreLimpio = user.nombre ? user.nombre.trim() : '';
        const apellidoLimpio = user.apellido ? user.apellido.trim() : '';
        const fullName = `${nombreLimpio} ${apellidoLimpio}`.trim();
        const nameVariations = [fullName, nombreLimpio, `${nombreLimpio} `, `${nombreLimpio} undefined`];
        const respQuery = { $in: nameVariations.map(s => new RegExp(`^${s}`, 'i')) };

        // 1. Calcular Asistencias a través de Helper Compartido
        const stats = await calcularEstadisticasAsistenciaUsuario(user);
        let retardosTotales = stats.retardosTotales;
        let faltasTotales = stats.faltasTotales;
        let listaFaltas = stats.diasFalta;

        // 2. Calcular herramientas prestadas al empleado (Inventario Actual)
        const transactions = await InventoryTransaction.find({
            responsable: respQuery
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
            responsable: respQuery,
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

        const diasVacacionesDisponiblesCalc = await calcularVacacionesDinamicamente(user);

        // 4. Calcular eventos para el calendario nuevo (Faltas, Retardos, Vehiculos, Checkins)
        const vehicleTx = await VehicleTransaction.find({
            $or: [{ userId: user._id.toString() }, { userName: respQuery }, { responsable: respQuery }]
        }).sort({ fecha: 1 }).populate('vehicleId');

        let eventosCalendario = {};

        // Agregar checkins
        for (const [dateStr, checks] of Object.entries(stats.checkinsPorDia || {})) {
            if (!eventosCalendario[dateStr]) eventosCalendario[dateStr] = { falta: false, retardo: false, vehiculos: [], checkins: [] };
            eventosCalendario[dateStr].checkins = checks.map(c => ({
                tipo: c.tipo,
                time: new Date(c.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })
            }));
        }

        // Agregar faltas
        for (const fDate of stats.diasFalta || []) {
            if (!eventosCalendario[fDate]) eventosCalendario[fDate] = { falta: false, retardo: false, vehiculos: [], checkins: [] };
            eventosCalendario[fDate].falta = true;
        }

        // Agregar retardos
        for (const rDate of stats.diasRetardo || []) {
            if (!eventosCalendario[rDate]) eventosCalendario[rDate] = { falta: false, retardo: false, vehiculos: [], checkins: [] };
            eventosCalendario[rDate].retardo = true;
        }

        const pushVehiculosToCalendar = (startTx, endTx) => {
            const startStr = new Date(startTx.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            const endStr = endTx ? new Date(endTx.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

            let iter = new Date(startStr + 'T12:00:00Z');
            const end = new Date(endStr + 'T12:00:00Z');

            while (iter <= end) {
                const dStr = iter.toISOString().split('T')[0];
                if (!eventosCalendario[dStr]) eventosCalendario[dStr] = { falta: false, retardo: false, vehiculos: [], checkins: [] };
                const vName = startTx.vehicleId ? `${startTx.vehicleId.marca} ${startTx.vehicleId.modelo || ''}`.trim() : 'Vehículo';
                if (!eventosCalendario[dStr].vehiculos.includes(vName)) {
                    eventosCalendario[dStr].vehiculos.push(vName);
                }
                iter.setDate(iter.getDate() + 1);
            }
        };

        // Agregar feriados al calendario
        const currentYear = new Date().getFullYear();
        const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
        yearsToCheck.forEach(year => {
            const holidays = [];
            holidays.push(`${year}-01-01`);

            const getFirstMonday = (yr, mo) => {
                let dt = new Date(yr, mo, 1);
                while (dt.getDay() !== 1) { dt.setDate(dt.getDate() + 1); }
                return dt;
            };
            const getNthMonday = (yr, mo, n) => {
                let dt = getFirstMonday(yr, mo);
                dt.setDate(dt.getDate() + (n - 1) * 7);
                return dt;
            };

            const febHoliday = getNthMonday(year, 1, 1);
            holidays.push(`${year}-02-${String(febHoliday.getDate()).padStart(2, '0')}`);

            const marHoliday = getNthMonday(year, 2, 3);
            holidays.push(`${year}-03-${String(marHoliday.getDate()).padStart(2, '0')}`);

            holidays.push(`${year}-05-01`);
            holidays.push(`${year}-09-16`);

            if ((year - 2024) % 6 === 0) {
                holidays.push(`${year}-10-01`);
            }

            const novHoliday = getNthMonday(year, 10, 3);
            holidays.push(`${year}-11-${String(novHoliday.getDate()).padStart(2, '0')}`);

            holidays.push(`${year}-12-25`);

            for (const hDate of holidays) {
                if (!eventosCalendario[hDate]) eventosCalendario[hDate] = { falta: false, retardo: false, vehiculos: [], checkins: [] };
                eventosCalendario[hDate].feriado = true;
            }
        });

        // Agregar vehículos asignados
        let currentSalida = null;
        for (const tx of vehicleTx) {
            if (tx.tipoMovimiento === 'Préstamo') {
                currentSalida = tx;
            } else if (tx.tipoMovimiento === 'Devolución' && currentSalida) {
                pushVehiculosToCalendar(currentSalida, tx);
                currentSalida = null;
            }
        }
        if (currentSalida) {
            pushVehiculosToCalendar(currentSalida, null);
        }

        res.json({
            diasVacacionesDisponibles: diasVacacionesDisponiblesCalc,
            retardosTotales,
            faltasTotales,
            listaFaltas,
            herramientasActuales,
            weeklyHistory,
            eventosCalendario
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
        const { usaHorarioPersonalizado, horariosPorDia, diasVacacionesDisponibles, rol, fechaIngreso } = req.body;
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (usaHorarioPersonalizado !== undefined) user.usaHorarioPersonalizado = usaHorarioPersonalizado;
        if (horariosPorDia !== undefined) user.horariosPorDia = horariosPorDia;
        if (diasVacacionesDisponibles !== undefined) user.diasVacacionesDisponibles = diasVacacionesDisponibles;
        if (fechaIngreso !== undefined) user.fechaIngreso = fechaIngreso;
        if (rol !== undefined && ['admin', 'user', 'Clase C', 'socio'].includes(rol)) user.rol = rol;

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

// 1.3.2 Aceptar Términos y Condiciones
app.put('/api/users/:id/accept-terms', async (req, res) => {
    try {
        const { id } = req.params;
        const { evidencia } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (evidencia) {
            user.evidenciaTerminos = evidencia;
        }

        user.terminosAceptados = true;
        await user.save();

        res.json({ message: 'Términos aceptados correctamente.', user });
    } catch (e) {
        res.status(500).json({ error: 'Error aceptando términos legales.' });
    }
});

// Actualizar Perfil Extendido (RFC, NSS, Documentos)
app.put('/api/users/:id/profile-extended', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { rfc, nss, newDocument } = req.body;
        if (rfc !== undefined) user.rfc = rfc;
        if (nss !== undefined) user.nss = nss;
        if (newDocument) {
            user.documentos.push(newDocument);
        }

        await user.save();
        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Desactivar Empleado (Dar de baja)
app.put('/api/users/:id/deactivate', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        // Toggle between activa and inactiva
        user.estadoCuenta = user.estadoCuenta === 'activa' ? 'inactiva' : 'activa';
        await user.save();
        
        res.json({ success: true, estadoCuenta: user.estadoCuenta });
    } catch (e) {
        res.status(500).json({ error: e.message });
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

// --- REST API para App Móvil (Login simplificado) ---
app.post('/api/mobile/login', async (req, res) => {
    try {
        const { identificador, password } = req.body;
        if (!identificador || !password) return res.status(400).json({ error: 'Faltan credenciales.' });

        const user = await User.findOne({
            $or: [{ correo: identificador }, { telefono: identificador }, { numeroEmpleado: isNaN(identificador) ? null : Number(identificador) }]
        });

        if (!user || user.password !== password) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        if (user.estadoCuenta !== 'activa') {
            return res.status(403).json({ error: 'Cuenta pendiente de revisión por el administrador.' });
        }

        res.json(user);
    } catch (e) {
        res.status(500).json({ error: 'Error interno en login móvil.' });
    }
});

// --- Equipo Personal Endpoints ---
app.get('/api/personal-equipment', async (req, res) => {
    try {
        const query = {};
        if (req.query.userId) query.userId = req.query.userId;
        const eq = await PersonalEquipment.find(query).sort({ createdAt: -1 });
        res.json(eq.map(e => ({ ...e.toObject(), id: e._id.toString() })));
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo equipo personal.' });
    }
});

app.post('/api/personal-equipment', async (req, res) => {
    try {
        const { userId, userName, equipmentName, serialNumber, notes } = req.body;
        if (!userId || !userName || !equipmentName) {
            return res.status(400).json({ error: 'Faltan datos obligatorios.' });
        }

        const newEq = new PersonalEquipment({
            userId, userName, equipmentName, serialNumber, notes, estado: 'Pendiente'
        });
        await newEq.save();

        // Notificar al usuario
        notifyUser(userId, {
            title: "Nueva Asignación de Equipo",
            body: `Se te ha asignado: ${equipmentName}. Por favor, entrá a la aplicación para firmar de confirmación o rechazarlo.`,
            data: { view: 'herramientas', action: 'openPending' }
        });

        const responseObj = { ...newEq.toObject(), id: newEq._id.toString() };
        io.emit('new_personal_equipment', responseObj);
        res.status(201).json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error asignando equipo personal.' });
    }
});

app.put('/api/personal-equipment/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body; // 'Aceptado' or 'Rechazado'

        if (!['Aceptado', 'Rechazado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const eq = await PersonalEquipment.findById(id);
        if (!eq) return res.status(404).json({ error: 'Equipo no encontrado.' });

        eq.estado = estado;
        await eq.save();

        if (estado === 'Rechazado') {
            notifyAdmins({
                title: "Equipo Rechazado",
                body: `${eq.userName} ha rechazado la asignación de: ${eq.equipmentName}`,
                data: { view: 'adminEquipment' }
            });
        }

        const responseObj = { ...eq.toObject(), id: eq._id.toString() };
        io.emit('update_personal_equipment', responseObj);
        res.json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando estado del equipo.' });
    }
});

app.put('/api/personal-equipment/:id/missing', async (req, res) => {
    try {
        const { id } = req.params;
        const { isMissing } = req.body;

        const eq = await PersonalEquipment.findById(id);
        if (!eq) return res.status(404).json({ error: 'Equipo no encontrado.' });

        eq.isMissing = isMissing;
        if (isMissing && !eq.missingReportedAt) {
            eq.missingReportedAt = new Date();
        } else if (!isMissing) {
            eq.missingReportedAt = null;
        }

        await eq.save();

        if (isMissing) {
            notifyUser(eq.userId, {
                title: "Atención: Elemento Faltante",
                body: `Se reportó como faltante tu equipo: ${eq.equipmentName} durante una revisión.`,
                data: { view: 'herramientas' }
            });
        }

        const responseObj = { ...eq.toObject(), id: eq._id.toString() };
        io.emit('update_personal_equipment', responseObj);
        res.json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error marcando equipo como faltante.' });
    }
});

app.delete('/api/personal-equipment/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const eq = await PersonalEquipment.findByIdAndDelete(id);
        if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });

        io.emit('delete_personal_equipment', id);
        res.json({ message: 'Equipo eliminado/dado de baja exitosamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error al dar de baja el equipo.' });
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

        // Master Account Bypass: jonathan@naisata.com
        const isMaster = correo === 'jonathan@naisata.com';

        if (!isMaster) {
            if (user.estadoCuenta === 'pendiente') {
                return res.status(403).json({ error: 'Tu cuenta está pendiente de aprobación por un administrador.' });
            }

            if (user.estadoCuenta === 'rechazada') {
                return res.status(403).json({ error: 'Tu cuenta ha sido rechazada.' });
            }
        }

        if (!user.password) {
            return res.status(403).json({ error: 'REQUIRE_PASSWORD_SETUP' });
        }

        if (user.password !== password) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        if (!isMaster) {
            if (!user.firma) {
                return res.status(403).json({ error: 'REQUIRE_SIGNATURE_SETUP' });
            }

            if (!user.fotoPerfil) {
                return res.status(403).json({ error: 'REQUIRE_PHOTO_SETUP' });
            }
        }

        const userObj = user.toObject();

        if (isMaster) {
            userObj.rol = 'admin';
            userObj.estadoCuenta = 'activa';
            userObj.terminosAceptados = true;
            // Asegurar que siempre sea admin en la DB al loguear
            await User.updateOne({ correo: 'jonathan@naisata.com' }, { $set: { rol: 'admin', estadoCuenta: 'activa', terminosAceptados: true } });
        }

        userObj.diasVacacionesDisponibles = await calcularVacacionesDinamicamente(user);

        res.status(200).json({ message: 'Inicio de sesión exitoso', user: userObj });
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

// 4. Vehicles (Tracking)
app.get('/api/vehicles', async (req, res) => {
    try {
        const vehicles = await Vehicle.aggregate([
            {
                $addFields: {
                    equipmentCount: { $size: { $ifNull: ["$equipmentPhotos", []] } },
                    docsCount: { $size: { $ifNull: ["$documentosVehiculo", []] } }
                }
            },
            {
                $project: {
                    lastDamageReport: 0,
                    equipmentPhotos: 0,
                    documentosVehiculo: 0
                }
            },
            { $sort: { createdAt: -1 } }
        ]);
        res.json(vehicles);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo vehículos.' });
    }
});

app.get('/api/vehicles/:id/photos', async (req, res) => {
    try {
        const v = await Vehicle.findById(req.params.id).select('equipmentPhotos documentosVehiculo');
        if (!v) return res.status(404).json({ error: 'Vehículo no encontrado' });
        res.json({ equipmentPhotos: v.equipmentPhotos, documentosVehiculo: v.documentosVehiculo });
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo fotos del vehículo' });
    }
});

app.get('/api/vehicles/:id', async (req, res) => {
    try {
        const v = await Vehicle.findById(req.params.id);
        if (!v) return res.status(404).json({ error: 'No encontrado' });
        res.json(v);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo vehículo individual.' });
    }
});

app.get('/api/vehicles/:id/last-loan', async (req, res) => {
    try {
        const tx = await VehicleTransaction.findOne({ vehicleId: req.params.id, tipoMovimiento: 'Préstamo' }).sort({ createdAt: -1 });
        res.json(tx || {});
    } catch (e) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/vehicles', async (req, res) => {
    try {
        const { marca, modelo, color, placas, bitacoraEsperada, equipmentPhotos, documentosVehiculo, imei } = req.body;
        if (!marca || !modelo || !placas) return res.status(400).json({ error: 'Marca, modelo y placas son obligatorios.' });

        const newVehicle = new Vehicle({ marca, modelo, color, placas, bitacoraEsperada, equipmentPhotos, documentosVehiculo, imei });
        await newVehicle.save();
        res.status(201).json(newVehicle);
    } catch (e) {
        res.status(500).json({ error: 'Error interno registrando vehículo.' });
    }
});

app.put('/api/vehicles/:id', async (req, res) => {
    try {
        const v = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
        if (!v) return res.status(404).json({ error: 'No encontrado' });
        res.json(v);
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.delete('/api/vehicles/:id', async (req, res) => {
    try {
        await Vehicle.findByIdAndDelete(req.params.id);
        res.json({ message: 'Eliminado.' });
    } catch (e) {
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/api/vehicles/:id/loan', async (req, res) => {
    try {
        const { userId, userName, notas, bitacoraRevisada, imgReporteDanos, checklist, checklistNotas } = req.body;
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado.' });
        if (vehicle.estado !== 'Disponible') return res.status(400).json({ error: 'El vehículo no está disponible.' });

        if (vehicle.flespiId) {
            const speed = await getVehicleSpeed(vehicle.flespiId);
            if (speed > 3) {
                return res.status(400).json({ error: `Operación cancelada: El vehículo está en movimiento (${speed} km/h) y no puede ser bloqueado para asignación.` });
            }
            await sendFlespiCommand(vehicle.flespiId, 'off');
        }

        vehicle.estado = 'Pendiente de Confirmación';
        vehicle.currentUserId = userId;
        vehicle.currentUserName = userName;
        vehicle.encendido = false;
        await vehicle.save();

        const tx = new VehicleTransaction({
            vehicleId: vehicle._id,
            userId,
            userName,
            tipoMovimiento: 'Préstamo',
            notas,
            bitacoraRevisada,
            imgReporteDanos,
            checklist,
            checklistNotas,
            estadoConfirmacion: 'Pendiente'
        });
        await tx.save();

        if (userId !== 'EXTERNO') {
            notifyUserByName(userName, {
                title: "Vehículo Asignado",
                body: `Se te ha asignado un vehículo. Por favor, abre la app para firmar de conformidad.`,
                data: { view: 'herramientas', action: 'openPending' }
            });
        }

        io.emit('vehicle_updated', vehicle);

        res.status(200).json({ message: 'Vehículo en proceso de asignación (Firma pendiente).', transaction: tx });
    } catch (e) {
        res.status(500).json({ error: 'Error interno asignando.' });
    }
});

app.post('/api/vehicles/:id/return', async (req, res) => {
    try {
        const { userId, userName, notas, bitacoraRevisada, imgReporteDanos, kilometrajeActual, checklist, checklistNotas } = req.body;
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado.' });
        if (vehicle.estado !== 'Prestado') return res.status(400).json({ error: 'El vehículo no está prestado actualmente.' });

        if (vehicle.encendido === false && vehicle.flespiId) {
            await sendFlespiCommand(vehicle.flespiId, 'on');
        }

        vehicle.estado = 'Disponible';
        vehicle.currentUserId = null;
        vehicle.currentUserName = null;
        vehicle.encendido = true;
        if (kilometrajeActual) vehicle.kilometrajeActual = kilometrajeActual;
        if (imgReporteDanos) {
            vehicle.lastDamageReport = imgReporteDanos;
        }
        await vehicle.save();

        const tx = new VehicleTransaction({
            vehicleId: vehicle._id,
            userId,
            userName,
            tipoMovimiento: 'Devolución',
            notas,
            bitacoraRevisada,
            imgReporteDanos,
            kilometraje: kilometrajeActual,
            checklist,
            checklistNotas
        });
        await tx.save();

        if (userId !== 'EXTERNO') {
            notifyUser(userId, {
                title: "Vehículo Devuelto",
                body: `Tu devolución del vehículo ${vehicle.marca} ha sido confirmada en almacén.`,
                data: { view: 'herramientas' }
            });
        }

        io.emit('vehicle_updated', vehicle);

        res.status(200).json({ message: 'Vehículo devuelto exitosamente.', transaction: tx });
    } catch (e) {
        res.status(500).json({ error: 'Error interno devolviendo.' });
    }
});


const FLESPI_TOKEN = '933gcAbczGluPERbGkm0ktw72AEA829Jnf1pEEhO8dFjRtJXRfoY2ejMgNkxafb6';

async function sendFlespiCommand(flespiId, action) {
    if (!flespiId) return;
    try {
        // action === 'off' -> apagar motor (corte de corriente) -> value: true
        // action === 'on' -> encender motor (restablecer corriente) -> value: false
        const cleanId = String(flespiId).trim();
        // action === 'off' -> apagar motor -> "setdigout 0"
        // action === 'on' -> encender motor -> "setdigout 1"
        const cmdText = action === 'off' ? 'setdigout 0' : 'setdigout 1';
        
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
                'Authorization': `FlespiToken ${FLESPI_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        console.log(`[FLESPI] 'setdigout' (value: ${action === 'off'}) sent to device ${flespiId} via commands-queue. Response:`, data);
        
    } catch (e) {
        console.error('[FLESPI] Error sending command:', e);
    }
}

async function getVehicleSpeed(flespiId) {
    if (!flespiId) return 0;
    try {
        const cleanId = String(flespiId).trim();
        const response = await fetch(`https://flespi.io/gw/devices/${cleanId}/telemetry/position.speed`, {
            headers: { 'Authorization': `FlespiToken ${FLESPI_TOKEN}` }
        });
        const data = await response.json();
        if (data && data.result && data.result.length > 0 && data.result[0].telemetry && data.result[0].telemetry['position.speed']) {
            return data.result[0].telemetry['position.speed'].value || 0;
        }
        return 0;
    } catch (e) {
        console.error('[FLESPI] Error getting telemetry speed:', e);
        return 0;
    }
}

app.post('/api/vehicles/:id/engine', async (req, res) => {
    try {
        const { action, force } = req.body;
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado.' });

        if (action === 'off') {
            if (!force && vehicle.flespiId) {
                const speed = await getVehicleSpeed(vehicle.flespiId);
                if (speed > 3) {
                    return res.status(400).json({ error: `Operación cancelada: El vehículo está en movimiento (${speed} km/h). Utilice el paro de emergencia por robo si es estrictamente necesario.` });
                }
            }
            vehicle.encendido = false;
        } else if (action === 'on') {
            if (vehicle.estado === 'Pendiente de Confirmación' && !force) {
                return res.status(400).json({ error: 'Debes aceptar la asignación del vehículo antes de poder encenderlo.' });
            }
            vehicle.encendido = true;
        }
        
        // Send actual physical command to GPS
        if (vehicle.flespiId) {
            await sendFlespiCommand(vehicle.flespiId, vehicle.encendido ? 'on' : 'off');
        }

        await vehicle.save();
        
        if (typeof io !== 'undefined') {
            io.emit('vehicle_updated', vehicle);
        }

        res.status(200).json({ message: vehicle.encendido ? 'Bloqueo desactivado (Restaurado).' : 'Bloqueo activado (Motor cortado).', encendido: vehicle.encendido });
    } catch (e) {
        res.status(500).json({ error: 'Error interno cambiando estado del motor.' });
    }
});

app.post('/api/vehicles/:id/gasoline', async (req, res) => {
    try {
        const { userId, userName, gasolinaMonto, gasolinaLitros, gasolinaFoto, kilometrajeActual } = req.body;
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado.' });

        if (kilometrajeActual) {
            vehicle.kilometrajeActual = kilometrajeActual;
            await vehicle.save();
        }

        const tx = new VehicleTransaction({
            vehicleId: vehicle._id,
            userId, userName,
            tipoMovimiento: 'Gasolina',
            gasolinaMonto, gasolinaLitros, gasolinaFoto,
            kilometraje: kilometrajeActual
        });
        await tx.save();

        // Notificar a los administradores
        notifyAdmins({
            title: "Nuevo Ticket de Gasolina",
            body: `${userName} ha registrado una carga de gasolina por $${gasolinaMonto} para el vehículo ${vehicle.placas}.`,
            icon: "/icon.png",
            data: { view: 'adminTracking' }
        }).catch(e => console.error('Push notification error:', e));

        res.status(200).json({ message: 'Gasolina registrada exitosamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error registrando gasolina.' });
    }
});

app.post('/api/vehicles/:id/maintenance', async (req, res) => {
    try {
        const { notas, mantenimientoCosto, mantenimientoPiezas, mantenimientoTaller, fecha } = req.body;
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado.' });

        const tx = new VehicleTransaction({
            vehicleId: vehicle._id,
            userId: 'ADMIN',
            userName: 'Administrador',
            tipoMovimiento: 'Mantenimiento',
            notas,
            mantenimientoCosto,
            mantenimientoPiezas,
            mantenimientoTaller,
            fecha: fecha ? new Date(fecha) : new Date()
        });
        await tx.save();

        res.status(200).json({ message: 'Mantenimiento registrado exitosamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error registrando mantenimiento.' });
    }
});

app.get('/api/users/:id/vehicles', async (req, res) => {
    try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const txs = await VehicleTransaction.find({
            userId: req.params.id,
            fecha: { $gte: oneYearAgo }
        }).select('-firma -firmaUsuario -gasolinaFoto -imgReporteDanos -checklistNotas').sort({ fecha: -1 }).populate('vehicleId', 'marca modelo placas');

        // Uso de la nueva propiedad global del vehículo para evitar bucles visuales:
        const currentVehicles = await Vehicle.find({ currentUserId: req.params.id });

        res.json({
            currentVehicles,
            history: txs
        });
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial de vehículo.' });
    }
});

app.get('/api/vehicles/:id/history-route', async (req, res) => {
    try {
        const { id } = req.params;
        const days = parseInt(req.query.days) || 7;
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);

        const route = await VehicleRoutePoint.find({
            vehicleId: id,
            timestamp: { $gte: dateLimit }
        }).sort({ timestamp: 1 });

        res.json(route);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial de ruta.' });
    }
});

app.get('/api/vehicles/:id/history-stops', async (req, res) => {
    try {
        const { id } = req.params;
        const days = parseInt(req.query.days) || 7;
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);

        const stops = await VehicleStop.find({
            vehicleId: id,
            createdAt: { $gte: dateLimit }
        }).sort({ startTime: -1 }); // newer first

        res.json(stops);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial de paradas.' });
    }
});

app.get('/api/vehicles/:id/history', async (req, res) => {
    try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const txs = await VehicleTransaction.find({
            vehicleId: req.params.id,
            fecha: { $gte: oneYearAgo }
        }).select('-firma -firmaUsuario -gasolinaFoto -imgReporteDanos -checklistNotas').sort({ fecha: -1 }).populate('vehicleId', 'marca modelo placas');

        res.json({ history: txs });
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial del vehículo.' });
    }
});

app.get('/api/vehicle-transaction/:id/photos', async (req, res) => {
    try {
        const tx = await VehicleTransaction.findById(req.params.id).select('gasolinaFoto imgReporteDanos');
        if (!tx) return res.status(404).json({ error: 'Transacción no encontrada' });
        res.json({ gasolinaFoto: tx.gasolinaFoto, imgReporteDanos: tx.imgReporteDanos });
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo fotos de transacción.' });
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

        notifyAdmins({
            title: "Entregable Firmado",
            body: `El cliente ${nombreCliente} ha firmado el Entregable / Ticket con folio ${ticket.folio || ticketId}.`,
            data: { view: 'adminTickets' }
        });

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

        // Notificación de Push al usuario
        if (typeof notifyUser === 'function') {
            notifyUser(userId, {
                title: `Checador: ${tipo} Registrada`,
                body: `Se ha registrado tu ${tipo.toLowerCase()} a las ${new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })}.`,
                data: { view: 'perfil' }
            });
        }

        res.status(201).json(newCheckIn);
    } catch (e) {
        console.error('Error guardando registro de checador:', e);
        res.status(500).json({ error: 'Error guardando registro de checador.' });
    }
});

// Endpoint exclusivo para el Checador Local con Cámara IP (Sin foto ni ubicación)
app.post('/api/face-checkin', async (req, res) => {
    try {
        const { userId, tipo } = req.body;
        if (!userId || !tipo) return res.status(400).json({ error: 'Faltan datos de usuario o tipo.' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Validar si ya hizo ese movimiento hoy
        const existingCheckin = await CheckIn.findOne({
            userId,
            tipo,
            timestamp: { $gte: today }
        });

        if (existingCheckin) {
            return res.status(400).json({ error: `Ya tienes una ${tipo} registrada hoy.`, user });
        }

        const newCheckIn = new CheckIn({
            userId,
            userName: `${user.nombre} ${user.apellido}`,
            tipo,
            servicio: 'Cámara Hikvision Local',
            ubicacion: { lat: 0, lng: 0, address: 'Oficina Central (IP)' },
            timestamp: new Date()
        });

        await newCheckIn.save();
        io.emit('new_checkin', newCheckIn);

        // Notificación de Push al usuario
        if (typeof notifyUser === 'function') {
            notifyUser(userId, {
                title: `Checador Facial: ${tipo} Registrada`,
                body: `Se ha registrado tu ${tipo.toLowerCase()} a las ${new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })} por la cámara IP.`,
                data: { view: 'perfil' }
            });
        }

        res.status(201).json({ message: 'Registrado con éxito', user });
    } catch (e) {
        console.error('Error en face-checkin:', e);
        res.status(500).json({ error: 'Error interno en face-checkin.' });
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

// Obtener registros de HOY para la máquina de estados del botón de un empleado
app.get('/api/checkins/today/:userId', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkins = await CheckIn.find({
            userId: req.params.userId,
            timestamp: { $gte: today }
        }).sort({ timestamp: 1 });
        res.json(checkins);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo registros de hoy.' });
    }
});

// 6.1 Reportes y Estadísticas para Administradores
app.get('/api/admin/clock-stats', async (req, res) => {
    try {
        const users = await User.find({}).select('nombre apellido _id fechaIngreso fechaReinicioAsistencia horariosPorDia usaHorarioPersonalizado rol');
        let report = [];

        for (const user of users) {
            const stats = await calcularEstadisticasAsistenciaUsuario(user);

            report.push({
                userId: user._id.toString(),
                empleado: `${user.nombre} ${user.apellido}`,
                faltasTotales: stats.faltasTotales,
                retardosTotales: stats.retardosTotales,
                diasFalta: stats.diasFalta,
                diasRetardo: stats.diasRetardo,
                historial: stats.checkinsPorDia
            });
        }
        res.json(report);
    } catch (e) {
        console.error('Error stats admin:', e);
        res.status(500).json({ error: 'Error procesando stats.' });
    }
});

// Endpoint para reiniciar inasistencias y retardos
app.post('/api/admin/reset-attendance', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Falta parametro userId' });

        if (userId === 'all') {
            await User.updateMany({}, { $set: { fechaReinicioAsistencia: new Date() } });
        } else {
            await User.findByIdAndUpdate(userId, { $set: { fechaReinicioAsistencia: new Date() } });
        }
        res.json({ message: 'Asistencias reseteadas exitosamente' });
    } catch (e) {
        console.error('Error reseteando asistencias:', e);
        res.status(500).json({ error: 'Error interno reseteando asistencias' });
    }
});

// Endpoint para el "Empleado de la Semana" (Versión Optimizada)
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

        // Pre-fetch users
        const users = await User.find({ rol: { $in: ['user', 'Clase C'] } }).select('_id nombre apellido rol horariosPorDia usaHorarioPersonalizado fechaIngreso fechaReinicioAsistencia');
        const userMap = {};
        users.forEach(u => userMap[u._id.toString()] = u);

        const userStats = {};

        for (const checkin of checkins) {
            const uid = checkin.userId;
            if (!userMap[uid]) continue;

            if (!userStats[uid]) {
                userStats[uid] = {
                    _id: uid,
                    nombre: userMap[uid].nombre,
                    apellido: userMap[uid].apellido,
                    fotoPerfil: userMap[uid].fotoPerfil,
                    retardos: 0,
                    totalCheckins: 0
                };
            }

            userStats[uid].totalCheckins++;

            const u = userMap[uid];
            const date = new Date(checkin.timestamp);
            const dayOfWeek = date.getDay();

            let horarioDia = u.usaHorarioPersonalizado && u.horariosPorDia
                ? u.horariosPorDia.find(h => h.dia === dayOfWeek)
                : globalHorarios.find(h => h.dia === dayOfWeek);

            if (horarioDia && horarioDia.activo && horarioDia.entrada) {
                const [h, m] = horarioDia.entrada.split(':').map(Number);
                const entryTimeMinutes = h * 60 + m;
                const checkinTimeMinutes = date.getHours() * 60 + date.getMinutes();

                if (checkinTimeMinutes > (entryTimeMinutes + globalTolerancia)) {
                    userStats[uid].retardos++;
                }
            }
        }

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
                if (stat.totalCheckins > maxCheckins) {
                    maxCheckins = stat.totalCheckins;
                    winner = stat;
                }
            }
        }

        if (winner && winner._id) {
            const winnerFull = await User.findById(winner._id).select('fotoPerfil');
            if (winnerFull) winner.fotoPerfil = winnerFull.fotoPerfil;
        }

        res.json({ winner });

    } catch (e) {
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

        const diasDisponiblesCalculados = await calcularVacacionesDinamicamente(user);

        if (diasDisponiblesCalculados < diasSolicitados) {
            return res.status(400).json({ error: `No tienes suficientes días de vacaciones disponibles. Disponibles: ${diasDisponiblesCalculados}, Solicitados: ${diasSolicitados}` });
        }

        const newRequest = new VacationRequest({
            userId, userName, fechaInicio, fechaFin, diasSolicitados, motivo
        });

        await newRequest.save();

        notifyAdmins({
            title: "Nueva Solicitud de Vacaciones",
            body: `${userName} ha solicitado ${diasSolicitados} días libres.`,
            data: { view: 'adminVacations' }
        });

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

app.post('/api/vacations/historical', async (req, res) => {
    try {
        const { userId, userName, fechaInicio, fechaFin, diasSolicitados, motivo } = req.body;

        if (!userId || !fechaInicio || !fechaFin || !diasSolicitados) {
            return res.status(400).json({ error: 'Faltan campos requeridos.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        // A direct historical entry bypasses availability validation and goes straight to 'aprobada'
        const newRequest = new VacationRequest({
            userId,
            userName: userName || `${user.nombre} ${user.apellido}`,
            fechaInicio,
            fechaFin,
            diasSolicitados,
            motivo: motivo || 'Días históricos / previas al sistema',
            estado: 'aprobada' // Native approval guarantees immediate deduction
        });

        await newRequest.save();
        res.status(201).json(newRequest);
    } catch (e) {
        console.error('Error insertando vacacion historica:', e);
        res.status(500).json({ error: 'Error agregando historial de vacaciones.' });
    }
});

// --- Avisos / Anuncios Globales ---
app.get('/api/avisos', async (req, res) => {
    try {
        const { all } = req.query;
        let query = {};
        if (all !== 'true') {
            const today = new Date();
            query = {
                activo: true,
                fechaInicio: { $lte: today },
                fechaFin: { $gte: today }
            };
        }
        const avisos = await Aviso.find(query).sort({ createdAt: -1 });
        res.json(avisos);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo avisos.' });
    }
});

app.post('/api/avisos', async (req, res) => {
    try {
        const { titulo, mensaje, imagen, fechaInicio, fechaFin, requiereActualizacion } = req.body;
        if (!titulo || !mensaje || !fechaInicio || !fechaFin) {
            return res.status(400).json({ error: 'Título, mensaje, fecha inicio y fin son obligatorios.' });
        }

        const nuevoAviso = new Aviso({
            titulo,
            mensaje,
            imagen,
            fechaInicio: new Date(fechaInicio + "T00:00:00"),
            fechaFin: new Date(fechaFin + "T23:59:59"),
            requiereActualizacion
        });
        await nuevoAviso.save();

        notifyAll({
            title: `Aviso: ${titulo}`,
            body: mensaje
        });

        res.status(201).json(nuevoAviso);
    } catch (e) {
        console.error('Error insertando aviso:', e);
        res.status(500).json({ error: 'Error creando aviso.', details: e.message });
    }
});

app.delete('/api/avisos/:id', async (req, res) => {
    try {
        await Aviso.findByIdAndDelete(req.params.id);
        res.json({ message: 'Aviso eliminado' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando aviso.' });
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

        notifyUser(request.userId, {
            title: "Actualización de Solicitud",
            body: `Tu solicitud de vacaciones ha sido ${estado.toUpperCase()}.`,
            data: { view: 'perfil' }
        });

        res.json(request);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando estado de la solicitud.' });
    }
});

app.delete('/api/vacations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const request = await VacationRequest.findById(id);
        if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        if (request.estado !== 'pendiente') {
            return res.status(400).json({ error: 'Solo se pueden eliminar solicitudes pendientes.' });
        }
        await VacationRequest.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Error al eliminar la solicitud.' });
    }
});

app.put('/api/vacations/:id/revert', async (req, res) => {
    try {
        const { id } = req.params;
        const request = await VacationRequest.findById(id);
        if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });

        if (request.estado === 'aprobada') {
            // Refund days if it was approved
            const user = await User.findById(request.userId);
            if (user) {
                user.diasVacacionesDisponibles = (user.diasVacacionesDisponibles || 0) + request.diasSolicitados;
                await user.save();
            }
        }
        
        request.estado = 'pendiente';
        await request.save();
        
        res.json({ success: true, request });
    } catch (e) {
        res.status(500).json({ error: 'Error al revertir la solicitud.' });
    }
});


// --- Interactive Plans & Markers ---
app.get('/api/projects', async (req, res) => {
    try {
        const { tipo } = req.query;
        let filter = {};
        if (tipo === 'General') {
            filter = { $or: [{ tipo: 'General' }, { tipo: { $exists: false } }] };
        } else if (tipo) {
            filter = { tipo };
        }
        const projects = await ProjectModel.find(filter).sort({ createdAt: -1 });
        const mapped = projects.map(p => ({ ...p.toObject(), id: p._id.toString() }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo proyectos.' });
    }
});

app.get('/api/projects/:id/transactions', async (req, res) => {
    try {
        const { id } = req.params;
        const txs = await InventoryTransaction.find({ proyectoId: id })
            .populate('itemId', 'nombre numeroParte tipo')
            .sort({ fecha: -1 });
        res.json(txs);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo transacciones del proyecto.' });
    }
});

app.get('/api/projects/:id/dashboard', async (req, res) => {
    try {
        const { id } = req.params;
        const project = await ProjectModel.findById(id);
        if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

        const invTxs = await InventoryTransaction.find({ proyectoId: id }).populate('itemId');
        
        let insumosConsumidos = 0;
        let herramientasAsignadas = 0;
        const desglose = [];

        invTxs.forEach(tx => {
            if (tx.itemId) {
                if (tx.itemId.tipo === 'Insumo') {
                    if (tx.tipoMovimiento === 'Salida') {
                        insumosConsumidos += tx.cantidad;
                        desglose.push({
                            fecha: tx.fecha,
                            tipo: 'Insumo (Salida)',
                            descripcion: `${tx.cantidad}x ${tx.itemId.nombre}`,
                            responsable: tx.responsable
                        });
                    } else if (tx.tipoMovimiento === 'Devolucion' || tx.tipoMovimiento === 'Devolución') {
                        insumosConsumidos -= tx.cantidad;
                        desglose.push({
                            fecha: tx.fecha,
                            tipo: 'Insumo (Devolución)',
                            descripcion: `${tx.cantidad}x ${tx.itemId.nombre}`,
                            responsable: tx.responsable
                        });
                    }
                } else if (tx.itemId.tipo === 'Herramienta') {
                    if (tx.tipoMovimiento === 'Salida' || tx.tipoMovimiento === 'Préstamo') {
                        herramientasAsignadas += tx.cantidad;
                        desglose.push({
                            fecha: tx.fecha,
                            tipo: 'Herramienta (Asignada)',
                            descripcion: `${tx.cantidad}x ${tx.itemId.nombre}`,
                            responsable: tx.responsable
                        });
                    } else if (tx.tipoMovimiento === 'Devolucion' || tx.tipoMovimiento === 'Devolución') {
                        herramientasAsignadas -= tx.cantidad;
                        desglose.push({
                            fecha: tx.fecha,
                            tipo: 'Herramienta (Devuelta)',
                            descripcion: `${tx.cantidad}x ${tx.itemId.nombre}`,
                            responsable: tx.responsable
                        });
                    }
                }
            }
        });

        const vehTxs = await VehicleTransaction.find({ proyectoId: id }).populate('vehicleId');
        let vehiculosAsignados = new Set();

        vehTxs.forEach(tx => {
            if (tx.vehicleId) {
                vehiculosAsignados.add(tx.vehicleId._id.toString());
            }
            if (tx.tipoMovimiento === 'Asignación' || tx.tipoMovimiento === 'Préstamo' || tx.tipoMovimiento === 'Salida') {
                desglose.push({
                    fecha: tx.fecha,
                    tipo: 'Vehículo',
                    descripcion: `Asignación: ${tx.vehicleId ? tx.vehicleId.marca + ' ' + tx.vehicleId.modelo : 'Vehículo'}`,
                    responsable: tx.userName || tx.responsable || 'Desconocido'
                });
            }
        });

        desglose.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        res.json({
            project: { ...project.toObject(), id: project._id.toString() },
            metrics: {
                insumosConsumidos: Math.max(0, insumosConsumidos),
                herramientasAsignadas: Math.max(0, herramientasAsignadas),
                vehiculosAsignados: vehiculosAsignados.size
            },
            desglose
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error obteniendo dashboard del proyecto.' });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { tipo, nombre, descripcion, clienteId, presupuestoMateriales, presupuestoEstimado, estado, residenteId, ubicacion } = req.body;
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });

        const newProject = new ProjectModel({
            tipo: tipo || 'General',
            nombre,
            descripcion,
            clienteId,
            presupuestoMateriales: presupuestoMateriales || 0,
            presupuestoEstimado: presupuestoEstimado || 0,
            estado: estado || 'Activo',
            residenteId,
            ubicacion
        });
        await newProject.save();

        const responseObj = { ...newProject.toObject(), id: newProject._id.toString() };
        io.emit('new_project', responseObj);

        notifyAll({
            title: "Nuevo Proyecto Abierto",
            body: `Se ha abierto un nuevo proyecto/obra: ${nombre}.`,
            data: { view: 'adminProjects' } // Or whatever the view name is for projects
        });

        res.status(201).json(responseObj);
    } catch (e) {
        console.error('Error creando proyecto:', e);
        res.status(500).json({ error: 'Error agregando proyecto: ' + e.message, details: e.stack });
    }
});

app.put('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const updatedProject = await ProjectModel.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedProject) return res.status(404).json({ error: 'Proyecto no encontrado.' });

        const responseObj = { ...updatedProject.toObject(), id: updatedProject._id.toString() };
        io.emit('updated_project', responseObj);

        res.json(responseObj);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando proyecto.' });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedProject = await ProjectModel.findByIdAndDelete(id);
        if (!deletedProject) return res.status(404).json({ error: 'Proyecto no encontrado.' });

        const plans = await PlanModel.find({ proyectoId: id });
        for (const plan of plans) {
            await PlanMarker.deleteMany({ planId: plan._id });
            await plan.deleteOne();
        }

        io.emit('deleted_project', { id });
        res.json({ message: 'Proyecto eliminado correctamente.' });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando proyecto.' });
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

        notifyAll({
            title: "Nuevo Plano Asignado",
            body: `Se ha subido el plano "${nombre}" a los documentos de proyecto.`
        });

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
        const cached = AppCache.get('inventoryList');
        if (cached) return res.json(cached);

        const items = await InventoryItem.find().sort({ createdAt: -1 });
        const mapped = items.map(i => ({ ...i.toObject(), id: i._id.toString() }));
        AppCache.set('inventoryList', mapped, 5000); // 5 seconds TTL
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo inventario.' });
    }
});

app.post('/api/inventory', async (req, res) => {
    try {
        let { tipo, nombre, categoria, numeroParte, marca, ubicacion, cantidadEnStock, unidad, costoUnitario } = req.body;

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
        costoUnitario = parseFloat(costoUnitario) || 0;

        const newItem = new InventoryItem({
            tipo, nombre, categoria, numeroParte, marca, ubicacion, cantidadEnStock, unidad: unidad || 'piezas', costoUnitario
        });
        await newItem.save();

        const responseObj = { ...newItem.toObject(), id: newItem._id.toString() };
        io.emit('new_inventory_item', responseObj);

        // --- AUTO-INDUCTION (Gemini) ---
        (async () => {
            try {
                addLogLine('AI-INDUCT', `Analizando nuevo artículo: ${nombre}`);
                const items = await mongoose.model('InventoryItem').find({});
                const itemNames = items.map(i => i.nombre);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const prompt = `
Se acaba de agregar "${nombre}" a nuestro inventario.
Aquí tienes el catálogo completo actual: ${JSON.stringify(itemNames)}.
¿Con cuáles de los artículos existentes hace pareja lógicamente este nuevo artículo?
Genera un arreglo JSON de reglas de asociación usando el nuevo artículo como disparador (triggerKeyword) y los existentes como sugeridos (targetKeyword).
Formato estricto: [ { "triggerKeyword": "NOMBRE", "targetKeyword": "SUGERIDO", "codeFormula": "return triggerQty;" } ]
Solo devuelve el arreglo JSON válido, sin explicaciones ni formato markdown de código (\`\`\`json).
`;
                const result = await model.generateContent(prompt);
                let rawResp = result.response.text().trim();
                const jsonMatch = rawResp.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    rawResp = jsonMatch[0];
                } else {
                    rawResp = rawResp.replace(/^```json\s*/g, '').replace(/^```\s*/g, '').replace(/```\s*$/g, '').trim();
                }

                let newRules;
                try {
                    newRules = JSON.parse(rawResp);
                } catch (e) {
                    console.error("Auto-Induct JSON Parse Error. Raw:", rawResp);
                    return;
                }
                if (Array.isArray(newRules)) {
                    for (let r of newRules) {
                        const exists = await AiRule.findOne({ triggerKeyword: r.triggerKeyword, targetKeyword: r.targetKeyword });
                        if (!exists) {
                            await AiRule.create({
                                triggerKeyword: r.triggerKeyword, targetKeyword: r.targetKeyword,
                                codeFormula: r.codeFormula, confidence: 0.7, isActive: true
                            });
                        }
                    }
                }
                await AiLog.create({
                    eventType: 'INSPECTION', details: `Análisis automático del nuevo artículo: ${nombre}`,
                    prompt: prompt, response: rawResp
                });
            } catch (e) { console.error("Error auto-induction:", e); }
        })();

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
        let { tipo, nombre, categoria, numeroParte, marca, ubicacion, cantidadEnStock, unidad, costoUnitario } = req.body;

        const item = await InventoryItem.findById(id);
        if (!item) return res.status(404).json({ error: 'Item no encontrado.' });

        if (tipo) item.tipo = tipo.toUpperCase() === 'HERRAMIENTA' ? 'Herramienta' : 'Insumo';
        if (nombre) item.nombre = nombre.toUpperCase();
        if (categoria !== undefined) item.categoria = categoria;
        if (unidad !== undefined) item.unidad = unidad;
        if (numeroParte) item.numeroParte = numeroParte.toUpperCase();
        if (marca !== undefined) item.marca = marca.toUpperCase();
        if (ubicacion !== undefined) item.ubicacion = ubicacion.toUpperCase();
        if (cantidadEnStock !== undefined) item.cantidadEnStock = parseInt(cantidadEnStock) || 0;
        if (costoUnitario !== undefined) item.costoUnitario = parseFloat(costoUnitario) || 0;

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

        if (incident.enCampo) {
            // Falla en campo reportada desde el botón rápido: la herramienta seguía físicamente a cargo del empleado.
            // Al repararla el admin asume que ha regresado a manos de la empresa.
            // Auto-generamos la transacción de Devolución para saldar su adeudo.
            const tx = new InventoryTransaction({
                itemId: item._id,
                tipoMovimiento: 'Devolucion',
                cantidad: cantToRepair,
                responsable: incident.reportadoPor || 'Admin (Cierre Forzado)',
                firma: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
            });
            await tx.save();
            item.cantidadEnStock += cantToRepair;
        } else {
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

// --- NAISA AI (El Cerebro) Endpoints ---
app.post('/api/ai/suggest', async (req, res) => {
    try {
        const { cartItems } = req.body;
        if (!cartItems || cartItems.length === 0) return res.json({ suggestions: [] });

        const suggestions = [];
        const activeRules = await AiRule.find({ isActive: true });

        for (const item of cartItems) {
            const matchedRules = activeRules.filter(r => item.itemName.toUpperCase().includes(r.triggerKeyword.toUpperCase()));
            for (const rule of matchedRules) {
                if (cartItems.some(c => c.itemName.toUpperCase().includes(rule.targetKeyword.toUpperCase()))) continue;
                try {
                    const calcFunc = new Function('triggerQty', rule.codeFormula);
                    const suggestedQty = Math.round(calcFunc(item.qty));
                    if (suggestedQty > 0) {
                        suggestions.push({
                            trigger: item.itemName,
                            target: rule.targetKeyword,
                            qty: suggestedQty,
                            confidence: rule.confidence,
                            ruleId: rule._id
                        });
                    }
                } catch (e) { console.error("Error evaluando AI Rule:", e); }
            }
        }
        res.json({ suggestions });
    } catch (e) {
        res.status(500).json({ error: 'AI Error' });
    }
});

app.post('/api/ai/feedback', async (req, res) => {
    try {
        const { ruleId, accepted, triggerQty, suggestedQty, actualQty, userReason } = req.body;
        const rule = await AiRule.findById(ruleId);
        if (!rule) return res.status(404).json({ error: 'Rule not found' });

        if (accepted) {
            rule.successCount += 1;
            rule.confidence = Math.min(0.99, rule.confidence + 0.05);
        } else {
            rule.failCount += 1;
            rule.confidence = Math.max(0.1, rule.confidence - 0.05);

            if (rule.failCount > rule.successCount * 2 && rule.failCount > 3) {
                addLogLine('AI-EVOLVE', `Regla para ${rule.targetKeyword} mutando código usando Gemini...`);
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                    const prompt = `
Eres el motor evolutivo de programación de una Inteligencia Artificial.
Tu objetivo es arreglar la fórmula matemática en código JavaScript.
La regla actual para calcular cuántas unidades de "${rule.targetKeyword}" se necesitan basándose en la cantidad de "${rule.triggerKeyword}" es:
${rule.codeFormula}

Esta regla acaba de fallar miserablemente. El usuario metió ${triggerQty} de "${rule.triggerKeyword}", la IA sugirió ${suggestedQty} de "${rule.targetKeyword}", pero el usuario la rechazó. ${actualQty ? 'El usuario en realidad necesitaba ' + actualQty + '.' : ''}
${userReason ? 'El usuario te dejó este mensaje explicando tu error: "' + userReason + '". Ajusta tu lógica matemática basándote en esta explicación humana.' : ''}

Re-escribe la fórmula matemática en un código JavaScript limpio y puro (SIN bloques markdown de código, SIN la palabra javascript, SOLO la línea de código).
Debe tomar la variable global 'triggerQty' y retornar la cantidad numérica sugerida utilizando Math.
Ejemplo de formato estricto esperado: return Math.max(1, Math.ceil(triggerQty / 3));
`;
                    const result = await model.generateContent(prompt);
                    let newCode = result.response.text().trim();
                    newCode = newCode.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '').trim();

                    const oldCode = rule.codeFormula;
                    rule.codeFormula = newCode;
                    rule.successCount = 0;
                    rule.failCount = 0;
                    rule.lastEvolvedAt = new Date();
                    addLogLine('AI-EVOLVE', `Gemini programó nueva fórmula: ${newCode}`);

                    await AiLog.create({
                        eventType: 'EVOLUTION',
                        details: `Regla auto-programada para ${rule.targetKeyword}`,
                        prompt: prompt,
                        response: result.response.text(),
                        oldCode: oldCode,
                        newCode: newCode
                    });
                } catch (geminiErr) {
                    console.error("Gemini Error:", geminiErr);
                    // Fallback matemático básico
                    let ratio = actualQty ? (actualQty / triggerQty).toFixed(2) : (Math.random() * 2).toFixed(2);
                    if (ratio == 0 || ratio == "0.00") ratio = 0.5;
                    rule.codeFormula = `return Math.max(1, Math.round(triggerQty * ${ratio}));`;
                    rule.successCount = 0;
                    rule.failCount = 0;
                    rule.lastEvolvedAt = new Date();
                }
            }
        }
        await rule.save();
        res.json({ success: true, rule });
    } catch (e) {
        res.status(500).json({ error: 'AI Error' });
    }
});

app.get('/api/ai/logs', async (req, res) => {
    try {
        const logs = await AiLog.find().sort({ timestamp: -1 }).limit(50);
        res.json(logs);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/ai/rules', async (req, res) => {
    try {
        const rules = await AiRule.find().sort({ triggerKeyword: 1 });
        res.json(rules);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/ai/bootstrap', async (req, res) => {
    try {
        addLogLine('AI-BOOTSTRAP', 'Iniciando escaneo global del inventario con Gemini...');
        const items = await mongoose.model('InventoryItem').find({});
        const itemNames = items.map(i => i.nombre);

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
Eres un experto en inventarios de TI, telecomunicaciones y redes.
Aquí tienes el catálogo completo de nuestra empresa:
${JSON.stringify(itemNames)}

Analiza para qué sirve cada artículo y encuentra relaciones operativas lógicas entre ellos (qué herramientas se usan juntas, qué insumos dependen de otros, etc).
Genera un arreglo JSON estricto de reglas de asociación. Por ejemplo, si alguien saca "FUSIONADORA", debería sugerir "MANGAS".
No relaciones cosas obvias o redundantes. Limítate a las 10 o 20 asociaciones más críticas y útiles.
Formato estricto:
[
  { "triggerKeyword": "NOMBRE EN MAYUSCULAS DEL DISPARADOR", "targetKeyword": "NOMBRE EN MAYUSCULAS DEL SUGERIDO", "codeFormula": "return Math.max(1, triggerQty * 2);" }
]
Retorna ÚNICAMENTE un arreglo JSON válido, sin explicaciones, sin markdown de código (\`\`\`json), nada más. Solo el arreglo [].
`;
        const result = await model.generateContent(prompt);
        let rawResponse = result.response.text().trim();
        const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            rawResponse = jsonMatch[0];
        } else {
            rawResponse = rawResponse.replace(/^```json\s*/g, '').replace(/^```\s*/g, '').replace(/```\s*$/g, '').trim();
        }

        let newRules;
        try {
            newRules = JSON.parse(rawResponse);
        } catch (parseErr) {
            console.error("JSON Parse Error. Raw Gemini Response:", rawResponse);
            throw new Error("Gemini did not return valid JSON");
        }

        if (Array.isArray(newRules)) {
            for (let r of newRules) {
                const exists = await AiRule.findOne({ triggerKeyword: r.triggerKeyword, targetKeyword: r.targetKeyword });
                if (!exists) {
                    await AiRule.create({
                        triggerKeyword: r.triggerKeyword,
                        targetKeyword: r.targetKeyword,
                        codeFormula: r.codeFormula,
                        confidence: 0.8,
                        isActive: true
                    });
                }
            }
        }

        await AiLog.create({
            eventType: 'BOOTSTRAP',
            details: 'Escaneo global de inventario completado',
            prompt: prompt,
            response: rawResponse
        });

        res.json({ success: true, count: newRules.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error en Bootstrap' });
    }
});

// Endpoint for returning specific amount of an Insumo from a history transaction
app.post('/api/inventory/transaction/:txId/return-insumo', async (req, res) => {
    try {
        const { txId } = req.params;
        const returnAmount = parseInt(req.body.cantidad);
        if (!returnAmount || returnAmount <= 0) return res.status(400).json({ error: 'Cantidad inválida.' });

        const originalTx = await InventoryTransaction.findById(txId).populate('itemId');
        if (!originalTx) return res.status(404).json({ error: 'Transacción no encontrada.' });
        if (originalTx.tipoMovimiento !== 'Salida') return res.status(400).json({ error: 'Solo se puede devolver de un registro de Salida.' });
        if (!originalTx.itemId || originalTx.itemId.tipo !== 'Insumo') return res.status(400).json({ error: 'Este artículo no es un insumo válido.' });

        // Calculate how many have already been returned for this specific transaction
        // (Assuming we might track it, but simpler is to just check if returnAmount <= originalTx.cantidad)
        // For strict validation we could track `cantidadDevuelta` in the transaction document, but for now we'll just check if it exceeds original
        // Let's check total active loans of this item for this person/project combination to avoid negative balance, but simpler just use max qty.
        if (returnAmount > originalTx.cantidad) {
            return res.status(400).json({ error: 'No puedes devolver más cantidad de la que se sacó originalmente.' });
        }

        // Return to stock
        const item = originalTx.itemId;
        item.cantidadEnStock += returnAmount;
        await item.save();

        // Create return transaction
        const returnTx = new InventoryTransaction({
            tipoMovimiento: 'Devolucion',
            responsable: originalTx.responsable,
            firma: originalTx.firma || '',
            fecha: new Date(),
            itemId: item._id,
            cantidad: returnAmount,
            proyectoId: originalTx.proyectoId,
            costoTotal: 0,
            estadoConfirmacion: 'Confirmado'
        });
        await returnTx.save();

        io.emit('update_inventory_item', { ...item.toObject(), id: item._id.toString() });
        res.json({ message: 'Devolución parcial de insumo registrada con éxito.' });
    } catch (e) {
        console.error("Error returning insumo", e);
        res.status(500).json({ error: 'Error interno al procesar la devolución.' });
    }
});

app.post('/api/inventory/transaction', async (req, res) => {
    try {
        const { tipoMovimiento, responsable, firma, proyectoId } = req.body;
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
        const txItemsArr = [];
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
            txItemsArr.push({ itemId: item._id, cantidad: cant });
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

            const formattedItem = { ...item.toObject(), id: item._id.toString() };
            responseItems.push(formattedItem);
            io.emit('update_inventory_item', formattedItem);
        }

        // 3. Save transactions for each item
        for (let i = 0; i < txItemsArr.length; i++) {
            const itemTx = txItemsArr[i];
            const itemObj = itemDocs[i];
            const itemCost = itemObj.costoUnitario || 0;
            const txCost = tipoMovimiento === 'Salida' ? (itemCost * itemTx.cantidad) : 0;
            const isInsumo = itemObj.tipo === 'Insumo';

            const txParams = {
                tipoMovimiento, responsable, firma: firma || '', fecha: new Date(),
                itemId: itemTx.itemId, cantidad: itemTx.cantidad,
                proyectoId: proyectoId || null,
                costoTotal: txCost,
                estadoConfirmacion: (tipoMovimiento === 'Salida' && !isInsumo) ? 'Pendiente' : 'Confirmado'
            };
            const tx = new InventoryTransaction(txParams);
            await tx.save();
        }

        // Notify only if at least one item requires confirmation (is not an Insumo)
        const needsConfirmation = itemDocs.some(item => item.tipo !== 'Insumo');

        if (tipoMovimiento === 'Salida' && needsConfirmation) {
            notifyUserByName(responsable, {
                title: "Asignación de Inventario",
                body: `Se te han pre-asignado herramientas. Abre la app para firmar de conformidad.`,
                data: { view: 'herramientas', action: 'openPending' }
            });
        } else {
            notifyUserByName(responsable, {
                title: "Devolución de Inventario",
                body: `Se ha confirmado exitosamente la devolución de tus herramientas o insumos.`,
                data: { view: 'herramientas' }
            });
        }

        io.emit('inventory_transactions_updated', { responsable });

        res.status(201).json({ message: 'Transacción multi-ítem guardada con éxito.', items: responseItems });
    } catch (e) {
        console.error("error tx", e);
        res.status(500).json({ error: 'Error procesando la transacción multi-ítem.' });
    }
});

// --- Assignments Confirmation Flow ---
app.get('/api/assignments/pending/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'No user' });
        const nombreLimpio = user.nombre ? user.nombre.trim() : '';
        const apellidoLimpio = user.apellido ? user.apellido.trim() : '';
        const fullName = `${nombreLimpio} ${apellidoLimpio}`.trim();
        const nameVariations = [fullName, nombreLimpio, `${nombreLimpio} `, `${nombreLimpio} undefined`];

        const pendingInventory = await InventoryTransaction.find({
            responsable: {
                $in: nameVariations.map(s => new RegExp(`^${s}`, 'i'))
            },
            estadoConfirmacion: 'Pendiente'
        }).populate('itemId');

        const pendingVehicles = await VehicleTransaction.find({
            userId: req.params.userId,
            estadoConfirmacion: 'Pendiente'
        }).populate('vehicleId');

        res.json({ inventory: pendingInventory, vehicles: pendingVehicles });
    } catch (e) {
        res.status(500).json({ error: 'Error fetching assignments' });
    }
});

app.put('/api/assignments/:type/:id/confirm', async (req, res) => {
    try {
        const { firma } = req.body;
        if (!firma) return res.status(400).json({ error: 'Firma requerida' });

        if (req.params.type === 'inventory') {
            const tx = await InventoryTransaction.findById(req.params.id);
            if (!tx) return res.status(404).json({ error: 'Tx no encontrada' });
            tx.estadoConfirmacion = 'Confirmado';
            tx.firma = firma;
            await tx.save();
            io.emit('inventory_transactions_updated', { responsable: tx.responsable });
            res.json({ success: true });
        } else if (req.params.type === 'vehicle') {
            const tx = await VehicleTransaction.findById(req.params.id);
            if (!tx) return res.status(404).json({ error: 'Tx no encontrada' });
            tx.estadoConfirmacion = 'Confirmado';
            tx.firmaUsuario = firma;
            if (req.body.inspeccion) {
                tx.inspeccionPreviaje = req.body.inspeccion;
            }
            await tx.save();

            const v = await Vehicle.findById(tx.vehicleId);
            if (v) {
                v.estado = 'Prestado';
                if (v.encendido === false && v.flespiId) {
                    await sendFlespiCommand(v.flespiId, 'on');
                }
                v.encendido = true;
                await v.save();
                io.emit('vehicle_updated', v);
            }
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Type invalid' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Error confirming assignment' });
    }
});

app.put('/api/assignments/:type/:id/reject', async (req, res) => {
    try {
        if (req.params.type === 'inventory') {
            const tx = await InventoryTransaction.findById(req.params.id);
            if (!tx) return res.status(404).json({ error: 'Tx no encontrada' });

            const item = await InventoryItem.findById(tx.itemId);
            if (item && tx.tipoMovimiento === 'Salida') {
                item.cantidadEnStock += tx.cantidad;
                await item.save();
                io.emit('update_inventory_item', { ...item.toObject(), id: item._id.toString() });
            }

            tx.estadoConfirmacion = 'Rechazado';
            await tx.save();
            io.emit('inventory_transactions_updated', { responsable: tx.responsable });

            notifyAdmins({ 
                title: "Asignación Rechazada", 
                body: `${tx.responsable} rechazó la asignación de ${item ? item.nombre : 'un ítem'}.`, 
                data: { view: 'adminInventory' } 
            });
            res.json({ success: true });
        } else if (req.params.type === 'vehicle') {
            const tx = await VehicleTransaction.findById(req.params.id);
            if (!tx) return res.status(404).json({ error: 'Tx no encontrada' });

            tx.estadoConfirmacion = 'Rechazado';
            await tx.save();

            const v = await Vehicle.findById(tx.vehicleId);
            if (v) {
                v.estado = 'Disponible';
                v.currentUserId = null;
                v.currentUserName = null;
                await v.save();
                io.emit('vehicle_updated', v);
                notifyAdmins({ 
                    title: "Vehículo Rechazado", 
                    body: `${tx.userName} rechazó la asignación de ${v.marca} ${v.modelo}.`, 
                    data: { view: 'adminTracking' } 
                });
            }
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Type invalid' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Error rejecting assignment' });
    }
});

app.get('/api/inventory/transactions/history', async (req, res) => {
    try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const transactions = await InventoryTransaction.find({ fecha: { $gte: sixMonthsAgo } })
            .select('-firma')
            .sort({ fecha: -1 })
            .limit(500)
            .populate('itemId', 'nombre numeroParte tipo');

        res.json(transactions);
    } catch (e) {
        console.error("Error historial global:", e);
        res.status(500).json({ error: 'Error obteniendo historial global de inventario.' });
    }
});

app.get('/api/inventory/:id/transactions', async (req, res) => {
    try {
        const transactions = await InventoryTransaction.find({ itemId: req.params.id }).select('-firma').sort({ fecha: -1 });
        res.json(transactions);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo historial.' });
    }
});

app.get('/api/inventory/all-active-loans', async (req, res) => {
    try {
        const transactions = await InventoryTransaction.find({ estadoConfirmacion: { $ne: 'Rechazado' } })
            .select('-firma')
            .populate('itemId', 'nombre');
        const countMap = {};
        for (const t of transactions) {
            if (t.itemId) {
                const idStr = t.itemId._id.toString();
                if (!countMap[idStr]) countMap[idStr] = 0;
                if (t.tipoMovimiento === 'Salida') countMap[idStr] += t.cantidad;
                else if (t.tipoMovimiento === 'Devolucion') countMap[idStr] -= t.cantidad;
            }
        }
        const lentOutItemIds = Object.keys(countMap).filter(id => countMap[id] > 0);
        res.json(lentOutItemIds);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error fetching all active loans' });
    }
});

app.get('/api/inventory/loans/:responsable', async (req, res) => {
    try {
        const { responsable } = req.params;
        // Match the exact string of the selected user or entered "OTRO" name
        const transactions = await InventoryTransaction.find({ responsable: responsable })
            .select('-firma')
            .populate('itemId');

        const countMap = {};
        for (const t of transactions) {
            if (t.itemId && t.itemId.tipo !== 'Insumo') {
                const idStr = t.itemId._id.toString();
                if (!countMap[idStr]) {
                    countMap[idStr] = {
                        item: {
                            id: idStr,
                            nombre: t.itemId.nombre,
                            numeroParte: t.itemId.numeroParte,
                            tipo: t.itemId.tipo,
                            cantidadEnStock: t.itemId.cantidadEnStock,
                            historialFallas: t.itemId.historialFallas || []
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

// --- ZKTeco ADMS Endpoint ---
app.post('/api/zk-checkin', async (req, res) => {
    try {
        const { authorization } = req.headers;
        if (authorization !== 'Naisata_ZK_Secr3t_2026') {
            return res.status(401).json({ error: 'No autorizado / Token inválido' });
        }

        const { numeroEmpleado, timestamp, tipo } = req.body;
        if (!numeroEmpleado || !timestamp) {
            return res.status(400).json({ error: 'Faltan datos de asistencia (numeroEmpleado o timestamp)' });
        }

        const user = await User.findOne({ numeroEmpleado: Number(numeroEmpleado) });
        if (!user) {
            return res.status(404).json({ error: `Usuario con número de empleado ${numeroEmpleado} no encontrado.` });
        }

        // Determinar "Entrada" o "Salida" según el 'tipo' devuelto (o default Entrada)
        // Normalmente ZK manda un status que se traduce, pero asumiremos 'Entrada' si no lo mandan o si es 0, 'Salida' si es 1
        let checkInType = 'Entrada';
        if (tipo === '0') checkInType = 'Entrada';
        if (tipo === '1') checkInType = 'Salida';

        const checkinDate = new Date(timestamp);

        const fingerprintSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" style="background:%230f172a;"><circle cx="125" cy="100" r="45" fill="none" stroke="%233b82f6" stroke-width="8"/><circle cx="125" cy="100" r="25" fill="none" stroke="%233b82f6" stroke-width="8"/><text x="50%" y="78%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="24">ZKTeco</text><text x="50%" y="90%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="Arial, sans-serif" font-size="16">Verificado por Huella</text></svg>';

        const newCheckIn = new CheckIn({
            userId: user._id.toString(),
            userName: `${user.nombre} ${user.apellido}`,
            tipo: checkInType,
            servicio: 'Oficina (ZK Biométrico)',
            ubicacion: { lat: 0, lng: 0 },
            foto: fingerprintSvg,
            timestamp: checkinDate
        });

        await newCheckIn.save();

        // Emit socket to UI
        io.emit('new_checkin', newCheckIn);

        res.status(201).json({ message: 'Asistencia registrada correctamente.', checkIn: newCheckIn });
    } catch (e) {
        console.error('Error procesando ZK CheckIn:', e);
        res.status(500).json({ error: 'Error del servidor procesando ZK CheckIn' });
    }
});

// --- Facial Recognition Endpoints ---

app.post('/api/register-face', async (req, res) => {
    try {
        const { targetUserId, faceDescriptor } = req.body;
        // Basic security: only accept requests if it has data
        if (!targetUserId || !faceDescriptor || faceDescriptor.length === 0) {
            return res.status(400).json({ error: 'Datos insuficientes.' });
        }

        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.faceDescriptor = faceDescriptor;
        await user.save();
        res.json({ message: 'Rostro registrado con éxito' });
    } catch (e) {
        res.status(500).json({ error: 'Error interno registrando rostro.' });
    }
});

app.post('/api/face-checkin', async (req, res) => {
    try {
        const { userId, tipo } = req.body;
        if (!userId || !tipo) return res.status(400).json({ error: 'Faltan datos.' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const faceSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" style="background:%230f172a;"><circle cx="125" cy="100" r="45" fill="none" stroke="%238b5cf6" stroke-width="8"/><path d="M 100 90 Q 110 80 120 90" fill="none" stroke="%238b5cf6" stroke-width="6" stroke-linecap="round"/><path d="M 130 90 Q 140 80 150 90" fill="none" stroke="%238b5cf6" stroke-width="6" stroke-linecap="round"/><path d="M 110 115 Q 125 125 140 115" fill="none" stroke="%238b5cf6" stroke-width="6" stroke-linecap="round"/><text x="50%" y="78%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="24">Face-ID</text><text x="50%" y="90%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="Arial, sans-serif" font-size="16">Reconocimiento Facial</text></svg>';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingCheckIn = await CheckIn.findOne({
            userId: user._id.toString(),
            tipo: tipo,
            timestamp: { $gte: today, $lt: tomorrow }
        });

        if (existingCheckIn) {
            return res.status(400).json({ error: `Ya has registrado tu ${tipo.toLowerCase()} de hoy.`, user: user });
        }

        const newCheckIn = new CheckIn({
            userId: user._id.toString(),
            userName: `${user.nombre} ${user.apellido}`,
            tipo: tipo, // Entrada or Salida
            servicio: 'Oficina (Reconocimiento Facial)',
            ubicacion: { lat: 0, lng: 0 },
            foto: faceSvg,
            timestamp: new Date()
        });

        await newCheckIn.save();
        io.emit('new_checkin', newCheckIn);

        res.status(201).json({ message: 'Asistencia registrada correctamente.', checkIn: newCheckIn, user: user });
    } catch (e) {
        console.error('Error procesando Face CheckIn:', e);
        res.status(500).json({ error: 'Error del servidor procesando asistencia facial' });
    }
});

// --- Internal Mail API (Mensajería Naisata) ---
app.post('/api/mail', async (req, res) => {
    try {
        const { senderId, senderName, receiverId, receiverName, subject, body, status, attachments } = req.body;
        const msg = new InternalMessage({
            senderId, senderName, receiverId, receiverName, subject, body, status, attachments
        });
        await msg.save();
        res.status(201).json(msg);
    } catch (e) {
        res.status(500).json({ error: 'Error al enviar/guardar correo.' });
    }
});

app.put('/api/mail/:id', async (req, res) => {
    try {
        const msg = await InternalMessage.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
        res.json(msg);
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar el mensaje.' });
    }
});

app.get('/api/mail/inbox/:userId', async (req, res) => {
    try {
        const msgs = await InternalMessage.find({ receiverId: req.params.userId, status: 'enviado' }).sort({ createdAt: -1 });
        res.json(msgs);
    } catch (e) {
        res.status(500).json({ error: 'Error al cargar bandeja de entrada.' });
    }
});

app.get('/api/mail/sent/:userId', async (req, res) => {
    try {
        const msgs = await InternalMessage.find({ senderId: req.params.userId, status: 'enviado' }).sort({ createdAt: -1 });
        res.json(msgs);
    } catch (e) {
        res.status(500).json({ error: 'Error al cargar correos enviados.' });
    }
});

app.get('/api/mail/drafts/:userId', async (req, res) => {
    try {
        const msgs = await InternalMessage.find({ senderId: req.params.userId, status: 'borrador' }).sort({ createdAt: -1 });
        res.json(msgs);
    } catch (e) {
        res.status(500).json({ error: 'Error al cargar borradores.' });
    }
});

app.put('/api/mail/:id/read', async (req, res) => {
    try {
        const msg = await InternalMessage.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true });
        res.json(msg);
    } catch (e) {
        res.status(500).json({ error: 'Error al marcar como leído.' });
    }
});

app.delete('/api/mail/:id', async (req, res) => {
    try {
        await InternalMessage.findByIdAndDelete(req.params.id);
        res.json({ message: 'Mensaje eliminado.' });
    } catch (e) {
        res.status(500).json({ error: 'Error al eliminar el mensaje.' });
    }
});

// --- Help Requests API ---
app.post('/api/helprequests', async (req, res) => {
    try {
        const { requesterId, requesterName, assignedToId, assignedToName, description, targetDate } = req.body;
        const newReq = new HelpRequest({
            requesterId,
            requesterName,
            assignedToId,
            assignedToName,
            description,
            targetDate
        });
        await newReq.save();

        io.emit('new_help_request', newReq);

        const subs = await PushSubscription.find({ userId: assignedToId });
        const payload = {
            title: "Nueva Solicitud de Apoyo",
            body: `${requesterName} ha solicitado tu ayuda.`,
            icon: "/icon.png"
        };
        for (const sub of subs) {
            await sendPushNotification(sub.subscription, payload);
        }
        res.status(201).json(newReq);
    } catch (e) {
        console.error('Error creando ticket', e);
        res.status(500).json({ error: 'Error creando solicitud de ayuda' });
    }
});

app.get('/api/helprequests/:userId', async (req, res) => {
    try {
        const reqs = await HelpRequest.find({
            $or: [{ requesterId: req.params.userId }, { assignedToId: req.params.userId }]
        }).sort({ createdAt: -1 });
        res.json(reqs);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo solicitudes' });
    }
});

app.put('/api/helprequests/:id', async (req, res) => {
    try {
        const updated = await HelpRequest.findByIdAndUpdate(req.params.id, { status: req.body.status }, { returnDocument: 'after' });
        if (!updated) return res.status(404).json({ error: 'No encontrado' });

        io.emit('update_help_request', updated);

        const targetUserId = req.body.status === 'resuelto' ? updated.requesterId : updated.requesterId;
        const subs = await PushSubscription.find({ userId: targetUserId });
        const payload = {
            title: "Actualización de Ticket de Apoyo",
            body: `El ticket cambió a estado: ${updated.status}`,
            icon: "/icon.png"
        };
        for (const sub of subs) {
            await sendPushNotification(sub.subscription, payload);
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Error actualizando solicitud' });
    }
});
// --- Telemetry & AI Diagnose ---
app.post('/api/telemetry/error', (req, res) => {
    const errorData = req.body;
    addLogLine('TELEMETRY-ERROR', `Client Error: ${errorData.message} at ${errorData.source}:${errorData.lineno}:${errorData.colno}`);
    if (errorData.stack) {
        addLogLine('TELEMETRY-STACK', errorData.stack);
    }
    res.status(200).json({ success: true });
});

app.get('/api/ai/diagnose', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');

        const filesToRead = ['server.js', 'public/app.js', 'public/learn.html', 'public/tracking.js'];
        let codebaseContext = '';
        for (const file of filesToRead) {
            try {
                const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
                codebaseContext += `\n\n--- FILE: ${file} ---\n${content}\n`;
            } catch (err) {
                codebaseContext += `\n\n--- FILE: ${file} ---\n(Could not read file)\n`;
            }
        }

        const recentLogs = serverLogs.join('\n');

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `Aquí tienes el código fuente de mi plataforma y los registros recientes del servidor (incluyendo errores de telemetría de la PWA capturados en TELEMETRY-ERROR).
Busca los errores reportados en los registros, ve a la línea exacta en el código proporcionado, explícame por qué falló y dame el bloque de código corregido.

--- RECENT LOGS ---
${recentLogs}

--- CODEBASE CONTEXT ---
${codebaseContext}

Responde en formato claro, nombrando el archivo, línea, el motivo del fallo y la solución en código. Usa Markdown.`;

        const result = await model.generateContent(prompt);
        const diagnosis = result.response.text();

        addLogLine('AI-DIAGNOSE', 'Diagnostic requested and generated successfully.');
        res.json({ success: true, diagnosis });
    } catch (e) {
        console.error('Error generating AI diagnosis:', e);
        res.status(500).json({ error: 'Error generating diagnosis.' });
    }
});

app.get('/api/maps-key', (req, res) => {
    res.json({ key: process.env.api_maps || '38add3dbbf81f2d79d8472ee09de7f4e660955e988f72d010a428ba4366bed3d' });
});

// --- Keep-Alive con IA (Para evitar que Render se duerma) ---
app.get('/api/keep-alive', async (req, res) => {
    try {
        if (!genAI) {
            console.log('[Keep-Alive] Ping recibido (Sin IA configurada).');
            return res.json({ status: 'ok', message: 'Ping básico' });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = "Escribe un dato curioso muy corto (máx 15 palabras) sobre programación, servidores o tecnología.";
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        console.log(`[Keep-Alive IA] Servidor activo. Dato: ${text}`);
        res.json({ status: 'ok', ai_message: text });
    } catch (e) {
        console.error('[Keep-Alive] Error contactando a Gemini:', e.message);
        res.json({ status: 'ok', error: 'IA no disponible' });
    }
});


// --- SYSCOM API INTEGRATION ---
let syscomToken = null;
let syscomTokenExpiry = 0;

async function getSyscomToken() {
    if (syscomToken && Date.now() < syscomTokenExpiry) {
        return syscomToken;
    }

    const clientId = process.env.SYSCOM_CLIENT_ID;
    const clientSecret = process.env.SYSCOM_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Syscom credentials not configured in environment.");
    }

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'client_credentials');

    const response = await fetch('https://developers.syscom.mx/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Syscom OAuth Error:", errorText);
        throw new Error("Failed to obtain Syscom Token: " + errorText);
    }

    const data = await response.json();
    syscomToken = data.access_token;
    // Expira en data.expires_in segundos. Restamos 60s por seguridad.
    syscomTokenExpiry = Date.now() + ((data.expires_in - 60) * 1000);
    return syscomToken;
}

app.get('/api/syscom/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Falta término de búsqueda' });

        const token = await getSyscomToken();
        const response = await fetch(`https://developers.syscom.mx/api/v1/productos?busqueda=${encodeURIComponent(q)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Error consultando Syscom API");
        const data = await response.json();

        res.json(data);
    } catch (e) {
        console.error("Syscom Error:", e.message);
        res.status(500).json({ error: 'Error conectando con Syscom' });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API ejecutándose en el puerto ${PORT}`);
});

io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
        delete activeSocketsMap[socket.id];
        io.emit('it:users_count', Object.keys(activeSocketsMap).length);
        io.emit('it:users_count', io.engine.clientsCount);
    });

    socket.on('auth', (correo) => {
        activeSocketsMap[socket.id] = correo;
        io.emit('it:users_count', Object.keys(activeSocketsMap).length);
    });

    socket.on('admin:purge_cache', () => {
        logAdminAction('daniel@naisata.com', 'PURGE_CACHE', 'Purgó caché de todos los clientes');
        io.emit('admin:purge_cache');
    });

});
// --- Cron Job para Notificaciones de Feriados ---
const sentHolidayNotifications = {};

async function runCronRoutine() {
    try {
        const now = new Date();
        const mxTimeStr = now.toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute: '2-digit' });

        // Ejecutar a las 08:00 AM CDMX o al ser invocado manualmente
        const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));

        const getStr = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        };

        const todayStr = getStr(today);

        const inTwoDays = new Date(today);
        inTwoDays.setDate(today.getDate() + 2);
        const inTwoDaysStr = getStr(inTwoDays);

        // Verificar si HOY es feriado y aún no hemos notificado
        if (isHoliday(todayStr) && !sentHolidayNotifications[`today_${todayStr}`]) {
            const reason = isHoliday(todayStr);
            const title = "¡Día de Descanso!";
            const body = `Hoy es un día de descanso oficial: ${reason}. ¡Disfruta tu día!`;

            await notifyAll({ title, body }).catch(e => console.error("Error push:", e));
            sentHolidayNotifications[`today_${todayStr}`] = true;
            console.log(`[Cron] Notificación de feriado enviada para hoy: ${todayStr}`);
        }

        // Verificar si en 2 DÍAS es feriado y aún no hemos notificado
        if (isHoliday(inTwoDaysStr) && !sentHolidayNotifications[`prep_${inTwoDaysStr}`]) {
            const reason = isHoliday(inTwoDaysStr);
            const title = "¡Próximo Descanso!";
            const body = `Prepárate: El ${inTwoDaysStr} será de descanso oficial por: ${reason}.`;

            await notifyAll({ title, body }).catch(e => console.error("Error push:", e));
            sentHolidayNotifications[`prep_${inTwoDaysStr}`] = true;
            console.log(`[Cron] Notificación preventiva enviada para el feriado: ${inTwoDaysStr}`);
        }
    } catch (e) {
        console.error('[Cron] Error verificando feriados:', e);
    }
}

global.runCronRoutine = runCronRoutine;

setInterval(() => {
    const now = new Date();
    const mxTimeStr = now.toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute: '2-digit' });
    if (mxTimeStr === '08:00') {
        runCronRoutine();
    }
}, 60000);

// --- Flespi GPS Webhook ---
app.post('/api/flespi/webhook', async (req, res) => {
    try {
        let data = req.body;
        console.log('[FLESPI WEBHOOK] Received payload:', JSON.stringify(data).substring(0, 500));
        if (!Array.isArray(data)) {
            data = [data]; // Si Flespi manda un solo objeto en vez de arreglo
        }
        if (Array.isArray(data)) {
            for (let msg of data) {
                const imei = msg.ident;
                const lat = msg['position.latitude'];
                const lng = msg['position.longitude'];
                const speed = msg['position.speed'] || 0;
                const direction = msg['position.direction'] || 0;
                const ignition = msg['engine.ignition.status'] !== undefined ? msg['engine.ignition.status'] : (speed > 0);
                const timestamp = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();
                
                if (imei && lat !== undefined && lng !== undefined) {
                    const vehicle = await Vehicle.findOne({ imei: String(imei) });
                    if (vehicle) {
                        console.log(`[FLESPI WEBHOOK] Match found for IMEI ${imei}. Updating location...`);
                        const newLoc = { lat, lng, speed, direction, ignition, timestamp };
                        
                        const wasMoving = vehicle.lastLocation ? (vehicle.lastLocation.speed > 0) : false;
                        const isMoving = speed > 0;
                        
                        if (wasMoving && !isMoving) {
                            const stop = new VehicleStop({
                                vehicleId: vehicle._id,
                                userId: vehicle.currentUserId,
                                userName: vehicle.currentUserName,
                                lat, lng,
                                startTime: timestamp
                            });
                            await stop.save();
                            vehicle.currentStopId = stop._id;
                        } else if (!wasMoving && isMoving && vehicle.currentStopId) {
                            const stop = await VehicleStop.findById(vehicle.currentStopId);
                            if (stop) {
                                stop.endTime = timestamp;
                                stop.durationMinutes = Math.round((timestamp - stop.startTime) / 60000);
                                await stop.save();
                            }
                            vehicle.currentStopId = null;
                        }

                        vehicle.lastLocation = newLoc;
                        
                        VehicleRoutePoint.create({
                            vehicleId: vehicle._id,
                            lat, lng, speed, ignition, timestamp
                        }).catch(err => console.error('Error saving route point:', err));
                        
                        if (!vehicle.locationHistory) {
                            vehicle.locationHistory = [];
                        }
                        vehicle.locationHistory.push(newLoc);
                        // Limit to last 100 points for the route
                        if (vehicle.locationHistory.length > 100) {
                            vehicle.locationHistory = vehicle.locationHistory.slice(-100);
                        }
                        
                        await vehicle.save();
                        io.emit('vehicle_location_update', {
                            vehicleId: vehicle._id,
                            imei, lat, lng, speed, direction, ignition, timestamp,
                            route: vehicle.locationHistory
                        });
                    } else {
                        console.log(`[FLESPI WEBHOOK] WARNING: Received data for IMEI ${imei} but no vehicle was found in DB with this IMEI!`);
                    }
                } else {
                    console.log(`[FLESPI WEBHOOK] Skipping message: missing imei, lat, or lng. IMEI: ${imei}, LAT: ${lat}, LNG: ${lng}`);
                }
            }
        } else {
            console.log('[FLESPI WEBHOOK] Payload is not an array.');
        }
        res.status(200).send('OK');
    } catch(e) {
        console.error('Flespi webhook error:', e);
        res.status(500).send('Error');
    }
});

app.post('/api/it/broadcast', async (req, res) => {
    try {
        const { title, body } = req.body;
        if (!title || !body) return res.status(400).json({ error: 'Faltan campos' });
        await notifyAll({ title, body });
        res.json({ message: 'Notificación global enviada.' });
    } catch (err) {
        console.error('Error en broadcast:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/it/simulate-cron', (req, res) => {
    try {
        runCronRoutine();
        res.json({ message: 'Rutina simulada con éxito.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ---------------------------

