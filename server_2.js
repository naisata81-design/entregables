require('dotenv').config();

// Registro de diagnóstico en memoria
const waLog = {
    ultimoError: null,
    ultimaActividad: null,
    ultimoMensaje: null,
    historial: [],
    errores: [],   // Log de errores reales con stack
    add(msg) {
        const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        this.historial.unshift(`[${ts}] ${msg}`);
        if (this.historial.length > 30) this.historial.pop();
    },
    addError(label, err) {
        const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const entry = `[${ts}] ❌ ${label}: ${err && err.message ? err.message : String(err)}${err && err.stack ? '\n' + err.stack.split('\n').slice(1,4).join('\n') : ''}`;
        this.errores.unshift(entry);
        if (this.errores.length > 50) this.errores.pop();
        this.ultimoError = entry;
        this.historial.unshift(`[${ts}] ❌ ERROR: ${label}: ${err && err.message ? err.message.substring(0,80) : String(err).substring(0,80)}`);
        if (this.historial.length > 30) this.historial.pop();
    }
};

// Redirigir console.error y console.warn al waLog (no silenciarlos)
console.log = function() {};
console.info = function() {};
console.warn = function(...args) {
    waLog.add(`⚠️ [warn] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').substring(0,120)}`);
};
console.error = function(...args) {
    const msg = args.map(a => {
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack.split('\n').slice(1,4).join('\n') : '');
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const entry = `[${ts}] ❌ ${msg}`;
    waLog.errores.unshift(entry);
    if (waLog.errores.length > 50) waLog.errores.pop();
    waLog.ultimoError = entry;
    waLog.historial.unshift(`[${ts}] ❌ ${msg.substring(0,100)}`);
    if (waLog.historial.length > 30) waLog.historial.pop();
};

// Errores conocidos y transitorios de Puppeteer/WhatsApp Web que se pueden ignorar
const PUPPETEER_IGNORABLE_ERRORS = [
    'Execution context was destroyed',
    'Session closed',
    'Target closed',
    'Protocol error',
    'Cannot find context with specified id',
    'Navigating frame was detached',
    // Errores transitorios de MongoDB Atlas (elección de primary / failover)
    'primary marked stale',
    'No primary found',
    'Server selection timed out',
    'connection timed out',
    'ECONNRESET',
    'ECONNREFUSED',
];
const isPuppeteerNoise = (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    return PUPPETEER_IGNORABLE_ERRORS.some(e => msg.includes(e));
};

// Capturar errores no manejados globalmente
process.on('uncaughtException', async (err) => {
    if (isPuppeteerNoise(err)) return; // ignorar ruido de Puppeteer
    
    // ENOENT del ZIP = /app era read-only. Ahora usamos /tmp, no debe ocurrir.
    // NO borrar la sesión de MongoDB — puede ser válida y recuperable.
    if (err.code === 'ENOENT' && err.message && err.message.includes('RemoteAuth')) {
        waLog.add('⚠️ ZIP de sesión no encontrado en disco (ENOENT). Reiniciando bot para reintentar...');
        waStatus = 'DESCONECTADO';
        waReady = false;
        waInitializing = false;
        try {
            if (waClient) { try { await waClient.destroy(); } catch(_) {} waClient = null; }
        } catch(_) {}
        setTimeout(() => initWhatsApp(), 5000);
        return; // NO borrar MongoDB — la sesión puede seguir siendo válida
    }
    
    waLog.addError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
    if (isPuppeteerNoise(reason)) return; // ignorar ruido de Puppeteer
    waLog.addError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// Variable global para el cliente
let waClient = null;
let waReady = false;

// Función global para enviar mensajes
async function sendWhatsAppMessage(to, body) {
    if (!waReady || !waClient) {
        waLog.add('⚠️ Intentó enviar mensaje pero WhatsApp no está listo');
        throw new Error('WhatsApp no está listo');
    }
    try {
        // Limpiar el número (quitar espacios, guiones, etc)
        let cleanPhone = to.replace(/\D/g, '');
        // Si el número tiene 10 dígitos (formato México local), agregar 521
        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
        // Si tiene 12 dígitos y empieza con 52 pero sin el 1 de celular, agregarlo (opcional, WhatsApp a veces acepta 52)
        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
        
        const chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
        if (waClient) {
            await waClient.sendMessage(chatId, body);
            waLog.add(`✅ Notificación enviada a ${chatId}`);
        } else {
            waLog.add(`❌ waClient no está definido. No se pudo enviar a ${chatId}`);
        }
    } catch (e) {
        waLog.ultimoError = `[Enviando a ${to}]: ${e.message}`;
        waLog.add(`❌ Error notificando a ${to}: ${e.message.substring(0,50)}`);
    }
}
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Asegurar que el directorio de archivos exista (necesario en Render y otros servidores)
const ARCHIVOS_DIR = path.join(__dirname, 'public', 'archivos');
if (!fs.existsSync(ARCHIVOS_DIR)) {
    fs.mkdirSync(ARCHIVOS_DIR, { recursive: true });
    // console.log('📁 Directorio /public/archivos creado automáticamente');
}

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB max por archivo
});

const app = express();
const PORT = process.env.PORT || 3001; // Diferente puerto al principal

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://naisata:Hola2025@naisata.kwletg6.mongodb.net/naisata_db?retryWrites=true&w=majority&appName=naisata';

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    heartbeatFrequencyMS: 10000,
    socketTimeoutMS: 45000,
})
    .then(() => console.log('✅ CRM Conectado a MongoDB exitosamente'))
    .catch(err => console.error('❌ Error conectando a MongoDB desde CRM:', err.message));


// --- Schemas (Específicos para CRM/ERP) ---

// Schemas para lectura cruzada desde la DB principal (Tracking App)
const VehicleTransactionRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    vehicleId: { type: String, ref: 'VehicleRef' },
    userId: String,
    userName: String,
    tipoMovimiento: String,
    proyectoId: String,
    notas: String,
    checklist: Object,
    checklistNotas: String,
    imgReporteDanos: String,
    estadoConfirmacion: String,
    fecha: Date,
    fechaFirma: Date,
    nivelesReportados: String
}, { collection: 'vehicletransactions' });
const VehicleRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    placas: String, modelo: String, marca: String, estado: String, destinoSugeridoCRM: String
}, { collection: 'vehicles' });
const InvTransactionRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    itemId: { type: String, ref: 'InvItemRef' }, // String en lugar de ObjectId (migración BD)
    tipoMovimiento: String, cantidad: Number, responsable: String, proyectoId: String, fecha: Date
}, { collection: 'inventorytransactions' });
const InvItemRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String, tipo: String
}, { collection: 'inventoryitems' });
const UserRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String, apellido: String, telefono: String
}, { collection: 'users' });

// Schema de lectura cruzada: Tickets/Entregables de la app principal
const TicketRefSchema = new mongoose.Schema({
    _id: { type: String },
    siteId: String,
    proyectoId: String, // Algunos tickets tienen referencia directa al proyecto
    firmaTecnico: String,
    firmaCliente: String, // Si tiene valor = entregable firmado
    nombreCliente: String,
    folio: String,
    estado: String
}, { collection: 'tickets' });

const VehicleTransactionRef = mongoose.model('VehicleTransactionRef', VehicleTransactionRefSchema);
const VehicleRef = mongoose.model('VehicleRef', VehicleRefSchema);
const InvTransactionRef = mongoose.model('InvTransactionRef', InvTransactionRefSchema);
const InvItemRef = mongoose.model('InvItemRef', InvItemRefSchema);
const UserRef = mongoose.model('UserRef', UserRefSchema);
const TicketRef = mongoose.model('TicketRef', TicketRefSchema);

const CRMCotizacionSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    folio: { type: String, unique: true, sparse: true },
    clienteId: String,
    clienteNombre: String,
    vendedorId: String,
    descripcion: String,
    lugarEjecucion: String,
    contacto: String,
    condiciones: String,
    notas: String,
    creadorNombre: String,
    creadorCorreo: String,
    creadorTelefono: String,
    estado: { 
        type: String, 
        enum: ['Neutral', 'Levantamiento', 'Cotizando', 'En Seguimiento', 'Aprobado', 'Perdido', 'Perdida', 'Terminada', 'Cerrada', 'En Proceso', 'Ganada'], 
        default: 'Neutral' 
    },
    partidas: [{
        descripcion: String,
        cantidad: Number,
        um: String,
        precioUnitario: Number,
        total: Number
    }],
    subtotal: Number,
    iva: Number,
    total: Number,
    productosSugeridos: [{
        cantidad: Number,
        numeroParte: String,
        marca: String
    }],
    fechaCreacion: { type: Date, default: Date.now },
    fechaSeguimiento: Date,
    requiereRevision: { type: Boolean, default: false },
    proyectoActivoId: String, // Se llena cuando se aprueba y pasa a ERP
    archivos: [String] // URLs de documentos adjuntos (planos, fotos, PDFs del cliente)
});
const CRMCotizacion = mongoose.model('CRMCotizacion', CRMCotizacionSchema);

const CRMProyectoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    cotizacionId: String, // Referencia a la cotización original
    folio: String, // Identificador de proyecto heredado o nuevo
    nombre: String,
    clienteId: String,
    clienteNombre: String,
    residenteId: String, // Encargado
    trabajadoresAsignados: [String],
    vehiculosAsignados: [String],
    estado: { type: String, enum: ['Activo', 'Pausado', 'Terminado', 'Cancelado'], default: 'Activo' },
    fechaInicio: { type: Date, default: Date.now },
    fechaFin: Date,
    // Finanzas
    facturas: [{
        folio: String,
        descripcion: String,
        monto: Number,
        tipo: { type: String, enum: ['Ingreso', 'Egreso'] },
        archivoUrl: String, // PDF o Imagen
        fecha: { type: Date, default: Date.now }
    }],
    porcentajeAvance: { type: Number, default: 0 },
    avances: [{
        fecha: { type: Date, default: Date.now },
        empleado: String,
        porcentaje: Number,
        porcentajeProyecto: Number,
        comentario: String,
        fotos: [String]
    }],
    // Historial Diario / Bitácora
    bitacoraDiaria: [{
        fecha: Date,
        descripcion: String,
        personalAsistente: [String], // Quiénes fueron ese día
        vehiculosUtilizados: [String], // Qué carros se llevaron
        fotos: [String]
    }],
    archivos: [String] // IDs de documentos CRMArchivo en MongoDB
});
const CRMProyecto = mongoose.model('CRMProyecto', CRMProyectoSchema);

// Schema para almacenar archivos/imágenes en MongoDB (Base64)
const CRMArchivoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String,
    contentType: String,
    datos: String, // Base64
    tamanio: Number,
    fechaSubida: { type: Date, default: Date.now }
});
const CRMArchivo = mongoose.model('CRMArchivo', CRMArchivoSchema);

const CRMActividadSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    descripcion: String,
    asignadoAId: String, 
    asignadoANombre: String,
    cuadrillaNombres: [String],
    vehiculosAsignados: [String],
    tipoDestino: String,
    proyectoId: String,
    estado: { type: String, enum: ['Pendiente', 'En Camino', 'En Sitio', 'En Progreso', 'Completada'], default: 'Pendiente' },
    fechaVencimiento: Date,
    horaInicio: String,  // "09:00" formato HH:MM
    horaFin: String,     // "13:00" formato HH:MM (opcional)
    avanceReportado: { type: Boolean, default: false },
    comentarioCierre: String,
    fechaCreacion: { type: Date, default: Date.now }
});
const CRMActividad = mongoose.model('CRMActividad', CRMActividadSchema);

const CRMEventoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    tipo: { type: String, enum: ['Junta', 'Levantamiento', 'Llamada', 'Otro'], default: 'Junta' },
    titulo: String,
    descripcion: String,
    fechaInicio: Date,
    fechaFin: Date,
    participantes: [String],
    vehiculosAsignados: [String],
    recordatorioEnviado: { type: Boolean, default: false },
    fechaCreacion: { type: Date, default: Date.now }
});
const CRMEvento = mongoose.model('CRMEvento', CRMEventoSchema);

const CRMAjustesSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    tipo: { type: String, default: 'general' },
    logoBase64: String,
    folioInicio: { type: Number, default: 1 }
});
const CRMAjustes = mongoose.model('CRMAjustes', CRMAjustesSchema);

// Helper: obtener el siguiente número de folio disponible
async function getNextFolioNumber() {
    const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
    const folioInicio = ajustes?.folioInicio || 1;
    // Buscar el mayor número de folio existente con formato C-NNN
    const cots = await CRMCotizacion.find({ folio: { $regex: /^C-\d+$/ } }).select('folio');
    let maxNum = folioInicio - 1;
    cots.forEach(c => {
        const num = parseInt(c.folio.replace('C-', ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return Math.max(maxNum + 1, folioInicio);
}

// --- API Routes ---

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'CRM Server is running' });
});

// Endpoint de diagnóstico — verifica estado de la conexión a MongoDB
app.get('/api/debug/status', (req, res) => {
    const estados = { 0: 'desconectado', 1: 'conectado', 2: 'conectando', 3: 'desconectando' };
    const dbState = mongoose.connection.readyState;
    res.json({
        server: 'OK',
        mongodb: estados[dbState] || `estado-${dbState}`,
        mongodbReadyState: dbState,
        uri_source: process.env.MONGODB_URI ? 'variable de entorno' : 'hardcoded',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const users = await UserRef.find().select('nombre apellido telefono').sort('nombre');
        res.json(users);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/test-phones', async (req, res) => {
    try {
        const users = await mongoose.connection.db.collection('users').find({}).toArray();
        res.json(users);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vehiculos/disponibles', async (req, res) => {
    try {
        // Obtenemos todos los vehiculos. El admin elegirá
        const vehs = await VehicleRef.find().select('placas modelo marca destinoSugeridoCRM').sort('modelo');
        res.json(vehs);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Rutas de Ajustes (Logo)
app.get('/api/ajustes/logo', async (req, res) => {
    try {
        const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        res.json({ logo: ajustes ? ajustes.logoBase64 : null });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/ajustes/logo', async (req, res) => {
    try {
        const { logoBase64 } = req.body;
        let ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        if (!ajustes) {
            ajustes = new CRMAjustes({ tipo: 'general', logoBase64 });
        } else {
            ajustes.logoBase64 = logoBase64;
        }
        await ajustes.save();
        res.json({ message: 'Logo guardado con éxito' });
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Rutas de Ajustes (Folio)
app.get('/api/ajustes/folio', async (req, res) => {
    try {
        const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        res.json({ folioInicio: ajustes?.folioInicio || 1 });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/ajustes/folio', async (req, res) => {
    try {
        const { folioInicio } = req.body;
        const num = parseInt(folioInicio, 10);
        if (isNaN(num) || num < 1) return res.status(400).json({ error: 'Número inválido' });
        let ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        if (!ajustes) {
            ajustes = new CRMAjustes({ tipo: 'general', folioInicio: num });
        } else {
            ajustes.folioInicio = num;
        }
        await ajustes.save();
        res.json({ message: `Folio inicial configurado a ${num}` });
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Rutas de Cotizaciones
app.get('/api/cotizaciones', async (req, res) => {
    try {
        const cots = await CRMCotizacion.find().sort({ fechaCreacion: -1 });
        res.json(cots);
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Asignar folios a TODAS las cotizaciones que no lo tengan (debe ir ANTES de /:id)
app.post('/api/cotizaciones/asignar-folios-todos', async (req, res) => {
    try {
        const sinFolio = await CRMCotizacion.find({
            $or: [
                { folio: { $exists: false } },
                { folio: null },
                { folio: '' },
                { folio: 'Sin folio' }
            ]
        }).sort({ fechaCreacion: 1 });

        let count = 0;
        for (const cot of sinFolio) {
            const num = await getNextFolioNumber();
            cot.folio = `C-${String(num).padStart(3, '0')}`;
            await cot.save();
            count++;
        }
        res.json({ message: `${count} cotizaciones actualizadas con folio.`, total: count });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cotizaciones/:id', async (req, res) => {
    try {
        const cot = await CRMCotizacion.findById(req.params.id);
        if (!cot) return res.status(404).json({ error: 'No encontrado' });
        res.json(cot);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/cotizaciones', async (req, res) => {
    try {
        const data = req.body;

        // Generar folio único — si hay colisión por concurrencia, reintentamos
        const folioManual = data.folio && data.folio.trim() !== '' && data.folio !== 'Sin folio' && data.folio !== 'Asignación Automática';

        if (folioManual) {
            // Folio proporcionado manualmente: verificar que no esté en uso
            const existe = await CRMCotizacion.findOne({ folio: data.folio.trim() });
            if (existe) {
                return res.status(409).json({ error: `El folio "${data.folio.trim()}" ya está en uso. Se asignará uno automáticamente.` });
            }
            data.folio = data.folio.trim();
        } else {
            // Folio automático con protección ante colisión por concurrencia
            let intentos = 0;
            let folioGenerado;
            while (intentos < 5) {
                const num = await getNextFolioNumber();
                folioGenerado = `C-${String(num).padStart(3, '0')}`;
                const existe = await CRMCotizacion.findOne({ folio: folioGenerado });
                if (!existe) break; // folio disponible
                intentos++;
            }
            data.folio = folioGenerado;
        }

        const newCotizacion = new CRMCotizacion(data);
        await newCotizacion.save();
        res.json({ message: 'Cotización creada con éxito', data: newCotizacion });
    } catch(err) {
        if (err.code === 11000) {
            // Error de índice único en MongoDB (race condition extrema)
            return res.status(409).json({ error: 'El folio generado ya existe. Por favor intenta de nuevo.' });
        }
        res.status(500).json({error: err.message});
    }
});

app.put('/api/cotizaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        // Prevent overwriting the folio with an empty string or default labels which trigger duplicate key E11000
        if (data.folio === '' || data.folio === 'Asignación Automática' || data.folio === 'Sin folio') {
            delete data.folio;
        }

        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, data, { new: true });
        if (!updatedCot) return res.status(404).json({ error: 'Cotización no encontrada' });
        res.json({ message: 'Cotización actualizada con éxito', data: updatedCot });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Subir archivos adjuntos a una cotización (planos, fotos, PDFs del cliente)
app.post('/api/cotizaciones/:id/archivos', upload.array('archivos', 10), async (req, res) => {
    try {
        const { id } = req.params;
        const cot = await CRMCotizacion.findById(id);
        if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
        if (!cot.archivos) cot.archivos = [];
        for (const file of req.files) {
            const archivo = new CRMArchivo({
                nombre: file.originalname,
                contentType: file.mimetype,
                datos: file.buffer.toString('base64'),
                tamanio: file.size
            });
            const saved = await archivo.save();
            cot.archivos.push(`/api/archivos/${saved._id}`);
        }
        await cot.save();
        res.json({ archivos: cot.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar un archivo adjunto de una cotización
app.delete('/api/cotizaciones/:id/archivos/:archivoId', async (req, res) => {
    try {
        const { id, archivoId } = req.params;
        const cot = await CRMCotizacion.findById(id);
        if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
        cot.archivos = (cot.archivos || []).filter(u => !u.includes(archivoId));
        await cot.save();
        await CRMArchivo.findByIdAndDelete(archivoId);
        res.json({ archivos: cot.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/cotizaciones/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        
        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, { estado: estado }, { new: true });
        if (!updatedCot) return res.status(404).json({ error: 'Cotización no encontrada' });
        
        res.json({ message: 'Estado actualizado', data: updatedCot });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Rutas de Proyectos
app.get('/api/proyectos', async (req, res) => {
    try {
        const proys = await CRMProyecto.find().sort({ fechaInicio: -1 });
        res.json(proys);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/proyectos', async (req, res) => {
    try {
        const data = req.body;
        const count = await CRMProyecto.countDocuments();
        
        let folioFinal = `P-${String(count + 1).padStart(3, '0')}`;
        
        // Asignar Folio heredado si existe
        if (data.cotizacionId) {
            const cot = await CRMCotizacion.findById(data.cotizacionId);
            if (cot && cot.folio) folioFinal = cot.folio;
            
            // Marcar cotizacion a "Ganada" si se pasa a proyectos operativos
            if (cot) {
                 cot.proyectoActivoId = folioFinal; 
                 cot.estado = 'Ganada';
                 await cot.save();
                 // Heredar documentos adjuntos de la cotización al proyecto
                 if (cot.archivos && cot.archivos.length > 0) {
                     data.archivos = cot.archivos;
                 }
            }
        }
        
        const newProy = new CRMProyecto({ ...data, folio: folioFinal });
        await newProy.save();
        res.json({ message: 'Proyecto creado con éxito', data: newProy });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        // Validación: Si se intenta cerrar/terminar, debe existir al menos un entregable firmado
        const ESTADOS_CIERRE = ['Terminada', 'Terminado', 'Cerrada', 'Cerrado', 'Cancelado'];
        if (data.estado && ESTADOS_CIERRE.includes(data.estado)) {
            const proyecto = await CRMProyecto.findById(id);
            if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

            // Buscar tickets firmados por el cliente vinculados a este proyecto
            // Se busca por: proyectoId directo, folio del proyecto, o _id del proyecto
            const folioProyecto = proyecto.folio || '';
            const ticketQuery = {
                firmaCliente: { $exists: true, $ne: null, $ne: '' },
                $or: [
                    { proyectoId: id },
                    { proyectoId: folioProyecto },
                    { proyectoId: { $regex: folioProyecto, $options: 'i' } }
                ]
            };

            const ticketFirmado = await TicketRef.findOne(ticketQuery).select('_id folio firmaCliente');

            if (!ticketFirmado) {
                return res.status(422).json({
                    error: `No se puede cerrar el proyecto "${folioProyecto}" porque no tiene ningún entregable firmado por el cliente. Genera y solicita la firma del entregable en la sección de Tickets antes de cerrar.`
                });
            }

            // Segunda Validación: La suma de facturas debe igualar al total de la cotización (si existe cotización asociada)
            if (proyecto.cotizacionId) {
                const cotizacion = await CRMCotizacion.findById(proyecto.cotizacionId);
                if (cotizacion && (cotizacion.total || cotizacion.total === 0)) {
                    const sumaFacturas = (proyecto.facturas || []).reduce((acc, f) => acc + (f.monto || 0), 0);
                    
                    // Permitir margen de $1 por posibles diferencias de redondeo en decimales
                    if (Math.abs(sumaFacturas - cotizacion.total) > 1) {
                        return res.status(422).json({
                            error: `No se puede cerrar el proyecto. La suma de facturas ($${sumaFacturas.toLocaleString('es-MX', {minimumFractionDigits:2})}) no coincide con el monto total de la cotización ($${cotizacion.total.toLocaleString('es-MX', {minimumFractionDigits:2})}).`
                        });
                    }
                }
            }
        }

        const updatedProy = await CRMProyecto.findByIdAndUpdate(id, data, { new: true });
        if (!updatedProy) return res.status(404).json({ error: 'Proyecto no encontrado' });
        res.json({ message: 'Proyecto actualizado con éxito', data: updatedProy });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/proyectos/:id/recursos', async (req, res) => {
    try {
        const proj = await CRMProyecto.findById(req.params.id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        
        let orConditions = [{ proyectoId: proj._id.toString() }];
        
        if (proj.folio && proj.folio.trim() !== '') {
            orConditions.push({ proyectoId: proj.folio.trim() });
            orConditions.push({ proyectoId: { $regex: proj.folio.trim(), $options: 'i' } });
            orConditions.push({ notas: { $regex: proj.folio.trim(), $options: 'i' } }); // Búsqueda en notas por [Destino CRM]
        }
        
        if (proj.nombre && proj.nombre.trim() !== '') {
            const safeSearch = proj.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
            orConditions.push({ notas: { $regex: safeSearch, $options: 'i' } });
        } else if (proj.clienteNombre && proj.clienteNombre.trim() !== '') {
            const safeSearch = proj.clienteNombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
            orConditions.push({ notas: { $regex: safeSearch, $options: 'i' } });
        }

        let q = { $or: orConditions };
        
        const vehTransactions = await VehicleTransactionRef.find(q)
                                        .populate('vehicleId')
                                        .sort({ fecha: -1 })
                                        .limit(50);
        
        const invTransactions = await InvTransactionRef.find(q)
                                        .populate('itemId')
                                        .sort({ fecha: -1 })
                                        .limit(50);
                                        
        // También incluir actividades CRM vinculadas para enriquecer historial
        const actividadesConditions = [
            { proyectoId: proj._id.toString() },
            { proyectoId: proj.folio }
        ];
        // Manejar formato legado "[Activo] P-003 - Nombre" que puede estar en la BD
        if (proj.folio) {
            actividadesConditions.push({ proyectoId: { $regex: proj.folio, $options: 'i' } });
        }
        if (proj.nombre) {
            const safeNombre = proj.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            actividadesConditions.push({ proyectoId: { $regex: safeNombre, $options: 'i' } });
        }
        if (proj.clienteNombre) {
            const safeCliente = proj.clienteNombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            actividadesConditions.push({ proyectoId: { $regex: safeCliente, $options: 'i' } });
        }
        const actividadesProy = await CRMActividad.find({ $or: actividadesConditions });

        // Personal de actividades CRM
        const personalCRM = new Set();
        actividadesProy.forEach(a => {
            if (a.asignadoANombre) personalCRM.add(a.asignadoANombre);
            (a.cuadrillaNombres || []).forEach(n => n && personalCRM.add(n));
        });

        // Vehículos de actividades CRM
        const vehiculosCRM = [];
        const allVehIds = new Set();
        actividadesProy.forEach(a => (a.vehiculosAsignados||[]).forEach(vid => allVehIds.add(vid)));
        if (allVehIds.size > 0) {
            const vehs = await VehicleRef.find({ _id: { $in: Array.from(allVehIds) } }).select('marca modelo placas');
            vehs.forEach(v => vehiculosCRM.push(v));
        }

        res.json({
            vehiculos: vehTransactions,
            herramientas: invTransactions,
            personalCRM: Array.from(personalCRM),
            vehiculosCRM,
            actividades: actividadesProy
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/archivos', upload.array('archivos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        if (!proj.archivos) proj.archivos = [];

        for (const file of req.files) {
            const archivo = new CRMArchivo({
                nombre: file.originalname,
                contentType: file.mimetype,
                datos: file.buffer.toString('base64'),
                tamanio: file.size
            });
            const saved = await archivo.save();
            proj.archivos.push(`/api/archivos/${saved._id}`);
        }
        await proj.save();
        res.json({ files: proj.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Servir archivos guardados en MongoDB
app.get('/api/archivos/:id', async (req, res) => {
    try {
        const archivo = await CRMArchivo.findById(req.params.id);
        if (!archivo) return res.status(404).send('Archivo no encontrado');
        const buffer = Buffer.from(archivo.datos, 'base64');
        res.set('Content-Type', archivo.contentType);
        res.set('Content-Disposition', `inline; filename="${archivo.nombre}"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/facturas', upload.single('archivo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { folio, monto } = req.body;
        let archivoUrl = null;
        if (req.file) {
            const archivo = new CRMArchivo({
                nombre: req.file.originalname,
                contentType: req.file.mimetype,
                datos: req.file.buffer.toString('base64'),
                tamanio: req.file.size
            });
            const saved = await archivo.save();
            archivoUrl = `/api/archivos/${saved._id}`;
        }
        
        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        
        if (!proj.facturas) proj.facturas = [];
        proj.facturas.push({ folio, monto: parseFloat(monto) || 0, archivoUrl, tipo: 'Ingreso', fecha: new Date() });
        await proj.save();
        res.json({ success: true, facturas: proj.facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/avance', upload.array('fotos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { empleado, porcentajeTarea, porcentajeProyecto, comentario, actividadId } = req.body;
        
        let fotosUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const archivo = new CRMArchivo({
                    nombre: file.originalname,
                    contentType: file.mimetype,
                    datos: file.buffer.toString('base64'),
                    tamanio: file.size
                });
                const saved = await archivo.save();
                fotosUrls.push(`/api/archivos/${saved._id}`);
            }
        }

        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");

        // Si se envió el ID de la actividad, verificar que no se haya reportado ya
        if (actividadId) {
            const act = await CRMActividad.findById(actividadId);
            if (act) {
                if (act.avanceReportado) {
                    return res.status(400).send("Ya se reportó un avance para esta tarea.");
                }
                act.avanceReportado = true;
                await act.save();
            }
        }

        const pctTarea = parseInt(porcentajeTarea, 10) || 0;
        const pctProyecto = parseInt(porcentajeProyecto, 10) || 0;
        
        proj.avances.push({
            empleado,
            porcentaje: pctTarea,
            porcentajeProyecto: pctProyecto,
            comentario,
            fotos: fotosUrls
        });
        
        // Actualizar porcentaje del proyecto si se proporcionó
        if (pctProyecto > 0) {
            proj.porcentajeAvance = pctProyecto;
        }
        
        await proj.save();
        
        res.json({ success: true, avance: proj.avances[proj.avances.length - 1] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id/porcentaje-global', async (req, res) => {
    try {
        const { id } = req.params;
        const { porcentaje } = req.body;
        
        const pct = parseInt(porcentaje, 10);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            return res.status(400).json({ error: "Porcentaje inválido. Debe ser entre 0 y 100." });
        }

        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");

        proj.porcentajeAvance = pct;
        await proj.save();

        res.json({ success: true, porcentajeAvance: proj.porcentajeAvance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// Rutas de Actividades
app.get('/api/actividades', async (req, res) => {
    try {
        const acts = await CRMActividad.find().sort({ fechaCreacion: -1 });
        res.json(acts);
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Detección de conflictos de recursos
// Helper compartido de solapamiento de horarios
const toMins = h => {
    if (!h || h === '') return null;
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm;
};
const solapan = (aIni, aFin, bIni, bFin) => {
    // Tratar null/vacío como rango completo del día (00:00 - 23:59)
    const aStart = toMins(aIni) ?? 0;
    const aEnd   = toMins(aFin) ?? 23 * 60 + 59;
    const bStart = toMins(bIni) ?? 0;
    const bEnd   = toMins(bFin) ?? 23 * 60 + 59;
    return aStart < bEnd && aEnd > bStart;
};

app.get('/api/actividades/conflictos', async (req, res) => {
    try {
        const { fecha, horaInicio, horaFin } = req.query;
        let empleados = req.query['empleados[]'] || req.query.empleados || [];
        let vehiculos = req.query['vehiculos[]'] || req.query.vehiculos || [];
        if (!Array.isArray(empleados)) empleados = [empleados];
        if (!Array.isArray(vehiculos)) vehiculos = [vehiculos];

        if (!fecha) return res.json({ vehiculosOcupados: [], empleadosOcupados: [], vehiculosBloqueados: [] });

        // Rango del día seleccionado (medianoche a medianoche UTC)
        const diaInicio = new Date(fecha + 'T00:00:00.000Z');
        const diaFin   = new Date(fecha + 'T23:59:59.999Z');

        // Todas las tareas y eventos de ese día
        const tareasDelDia = await CRMActividad.find({ 
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
            estado: { $ne: 'Completada' }
        });
        const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

        const vehiculosOcupados = [];
        const empleadosOcupados = [];

        // Normalizamos la lista de empleados buscados
        const empBuscados = empleados.map(e => e.trim().toLowerCase());

        tareasDelDia.forEach(t => {
            const hayConflicto = solapan(horaInicio || null, horaFin || null, t.horaInicio || null, t.horaFin || null);
            if (!hayConflicto) return;

            // Revisar vehículos
            (t.vehiculosAsignados || []).forEach(vId => {
                if (vehiculos.includes(vId) && !vehiculosOcupados.find(x => x.id === vId)) {
                    vehiculosOcupados.push({ id: vId, tarea: t.descripcion, horaInicio: t.horaInicio, horaFin: t.horaFin });
                }
            });

            // Revisar encargado principal y cuadrilla
            let empExistArr = [t.asignadoANombre, ...(t.cuadrillaNombres || [])]
                .filter(Boolean).join(',').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            empBuscados.forEach(b => {
                if (empExistArr.some(e => e === b || e.includes(b) || b.includes(e))) {
                    // Original name from query to let frontend match it
                    const origName = empleados.find(orig => orig.trim().toLowerCase() === b) || b;
                    if (!empleadosOcupados.find(x => x.nombre === origName)) {
                        empleadosOcupados.push({ nombre: origName, tarea: t.descripcion, horaInicio: t.horaInicio, horaFin: t.horaFin });
                    }
                }
            });
        });

        eventosDelDia.forEach(ev => {
            const hIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
            const hFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
            const hayConflicto = solapan(horaInicio || null, horaFin || null, hIni, hFin);
            if (!hayConflicto) return;

            (ev.vehiculosAsignados || []).forEach(vId => {
                if (vehiculos.includes(vId) && !vehiculosOcupados.find(x => x.id === vId)) {
                    vehiculosOcupados.push({ id: vId, tarea: ev.titulo, horaInicio: hIni, horaFin: hFin });
                }
            });

            let empExistArr = (ev.participantes || [])
                .filter(Boolean).join(',').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            empBuscados.forEach(b => {
                if (empExistArr.some(e => e === b || e.includes(b) || b.includes(e))) {
                    const origName = empleados.find(orig => orig.trim().toLowerCase() === b) || b;
                    if (!empleadosOcupados.find(x => x.nombre === origName)) {
                        empleadosOcupados.push({ nombre: origName, tarea: ev.titulo, horaInicio: hIni, horaFin: hFin });
                    }
                }
            });
        });

        // Vehículos bloqueados de Tracking
        const bloqueadosTracking = await VehicleRef.find({
            estado: { $in: ['Prestado', 'Pendiente de Confirmación'] }
        }).select('_id estado');

        const vehiculosBloqueados = bloqueadosTracking
            .filter(v => vehiculos.includes(v._id.toString()))
            .map(v => ({ id: v._id.toString(), estado: v.estado }));

        res.json({ vehiculosOcupados, empleadosOcupados, vehiculosBloqueados });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Obtener tareas de hoy para un empleado (para portal de empleados)
app.get('/api/empleados/mis-tareas-hoy', async (req, res) => {
    try {
        const { nombre } = req.query;
        if (!nombre) return res.status(400).json({error: 'Falta nombre'});

        // Rango de hoy en UTC
        const hoy = new Date();
        const fechaIso = hoy.toISOString().split('T')[0];
        const diaInicio = new Date(fechaIso + 'T00:00:00.000Z');
        const diaFin   = new Date(fechaIso + 'T23:59:59.999Z');

        // Buscar actividades donde sea asignado (encargado) o esté en cuadrilla
        const tareas = await CRMActividad.find({
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
            $or: [
                { asignadoANombre: nombre },
                { cuadrillaNombres: nombre }
            ]
        });

        // Enriquecer con info de vehículos y proyectos (archivos)
        const tareasEnriquecidas = await Promise.all(tareas.map(async (t) => {
            const tObj = t.toObject();
            tObj.isEncargado = t.asignadoANombre === nombre;

            // Vehiculos
            if (t.vehiculosAsignados && t.vehiculosAsignados.length > 0) {
                tObj.vehiculosInfo = await VehicleRef.find({ _id: { $in: t.vehiculosAsignados } }).select('marca modelo placas');
            } else {
                tObj.vehiculosInfo = [];
            }

            // Proyecto / Archivos
            if (t.proyectoId) {
                const mongooseQuery = require('mongoose');
                let orConditions = [];
                if (mongooseQuery.isValidObjectId(t.proyectoId)) {
                    orConditions.push({ _id: t.proyectoId });
                }
                orConditions.push({ folio: t.proyectoId });
                // También buscar por nombre parcial (para cuando proyectoId es texto)
                orConditions.push({ nombre: { $regex: t.proyectoId.split(']').pop().split('-').pop().trim(), $options: 'i' } });

                const proj = await CRMProyecto.findOne({ $or: orConditions });
                if (proj) {
                    tObj.proyectoNombreReal = proj.nombre;
                    tObj.proyectoObjectId = proj._id.toString(); // ID real para avances
                    tObj.archivos = proj.archivos || [];
                } else {
                    tObj.archivos = [];
                    tObj.proyectoObjectId = null;
                }
            } else {
                tObj.archivos = [];
                tObj.proyectoObjectId = null;
            }
            return tObj;
        }));

        res.json(tareasEnriquecidas);
    } catch(err) {
        res.status(500).json({error: err.message});
    }
});

app.post('/api/actividades', async (req, res) => {
    try {
        const data = req.body;

        // Ajuste de zona horaria para evitar desfase de 1 día (forzar mediodía UTC)
        if (data.fechaVencimiento && typeof data.fechaVencimiento === 'string' && data.fechaVencimiento.length === 10) {
            data.fechaVencimiento = data.fechaVencimiento + 'T12:00:00.000Z';
        }

        // --- Guard: verificar conflictos antes de guardar ---
        if (data.fechaVencimiento) {
            const fecha = new Date(data.fechaVencimiento).toISOString().split('T')[0];
            const diaInicio = new Date(fecha + 'T00:00:00.000Z');
            const diaFin   = new Date(fecha + 'T23:59:59.999Z');
            const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });
            const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

            const conflictos = [];
            
            let empNuevosArr = [data.asignadoANombre, ...(data.cuadrillaNombres || [])]
                .filter(Boolean).join(',').split(',')
                .map(s => s.trim().toLowerCase()).filter(Boolean);

            tareasDelDia.forEach(t => {
                if (!solapan(data.horaInicio || null, data.horaFin || null, t.horaInicio || null, t.horaFin || null)) return;
                
                (t.vehiculosAsignados || []).forEach(vId => {
                    if ((data.vehiculosAsignados || []).includes(vId))
                        conflictos.push(`Vehículo ocupado en tarea: "${t.descripcion}"`);
                });
                
                let empExistArr = [t.asignadoANombre, ...(t.cuadrillaNombres || [])]
                    .filter(Boolean).join(',').split(',')
                    .map(s => s.trim().toLowerCase()).filter(Boolean);
                
                empNuevosArr.forEach(n => {
                    // Verificación parcial e insensible a mayúsculas
                    if (empExistArr.some(e => e === n || e.includes(n) || n.includes(e))) {
                        conflictos.push(`Empleado ocupado en otra tarea: "${t.descripcion}"`);
                    }
                });
            });

            eventosDelDia.forEach(ev => {
                const horaIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                const horaFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                if (!solapan(data.horaInicio || null, data.horaFin || null, horaIni, horaFin)) return;
                
                (ev.vehiculosAsignados || []).forEach(vId => {
                    if ((data.vehiculosAsignados || []).includes(vId))
                        conflictos.push(`Vehículo ocupado en evento: "${ev.titulo}"`);
                });
                
                let empExistArr = (ev.participantes || [])
                    .filter(Boolean).join(',').split(',')
                    .map(s => s.trim().toLowerCase()).filter(Boolean);
                
                empNuevosArr.forEach(n => {
                    if (empExistArr.some(e => e === n || e.includes(n) || n.includes(e))) {
                        conflictos.push(`Empleado ocupado en junta/levantamiento: "${ev.titulo}"`);
                    }
                });
            });

            // También verificar vehículos bloqueados en Tracking
            if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
                const bloqueados = await VehicleRef.find({
                    _id: { $in: data.vehiculosAsignados },
                    estado: { $in: ['Prestado', 'Pendiente de Confirmación'] }
                }).select('modelo estado');
                bloqueados.forEach(v => {
                    conflictos.push(`Vehículo "${v.modelo}" está ${v.estado} en Tracking`);
                });
            }

            if (conflictos.length > 0) {
                return res.status(409).json({ error: 'Conflicto de recursos', conflictos });
            }
        }
        // --- Fin Guard ---

        const newAct = new CRMActividad(data);
        await newAct.save();

        // Inyectar etiqueta sugerida a vehículos seleccionados
        if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
            let label = data.destinoSugeridoCRMText;
            if (!label || label === '') label = data.descripcion || 'Tarea de CRM';
            for (const vId of data.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { destinoSugeridoCRM: label });
            }
        }

        // ✅ Responder al cliente INMEDIATAMENTE (sin esperar WhatsApp)
        res.json({ message: 'Actividad creada con éxito', data: newAct });

        // --- NOTIFICACIONES WHATSAPP (en segundo plano, NO bloquea la respuesta) ---
        setImmediate(async () => {
        try {
            const allUsers = await UserRef.find();
            const allVehs = await VehicleRef.find();
            
            const findPhone = (name) => {
                // Quitamos espacios dobles y lo pasamos a minúsculas
                const queryName = name.trim().toLowerCase().replace(/\s+/g, ' ');
                const u = allUsers.find(x => {
                    const soloNombre = (x.nombre || '').trim().toLowerCase();
                    const soloApellido = (x.apellido || '').trim().toLowerCase();
                    const fullName = `${soloNombre} ${soloApellido}`.trim().replace(/\s+/g, ' ');
                    
                    if (!fullName) return false;
                    
                    // Match exacto, o si uno contiene al otro (Ej. "Daniel" dentro de "Daniel Arevalos")
                    return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
                });
                return u && u.telefono ? u.telefono : null;
            };

            const vehiculosNombres = (data.vehiculosAsignados || []).map(vId => {
                const v = allVehs.find(x => x._id.toString() === vId);
                return v ? v.modelo : 'Desconocido';
            }).join(', ') || 'Ninguno';
            
            // Si el frontend envía los acompañantes como un solo string separado por comas, lo separamos
            let acompanantesArr = [];
            if (Array.isArray(data.cuadrillaNombres)) {
                acompanantesArr = data.cuadrillaNombres.filter(Boolean);
            } else if (typeof data.cuadrillaNombres === 'string') {
                acompanantesArr = data.cuadrillaNombres.split(',').map(s => s.trim()).filter(Boolean);
            }
            
            let encargadosArr = [];
            if (Array.isArray(data.asignadoANombre)) {
                encargadosArr = data.asignadoANombre.filter(Boolean);
            } else if (typeof data.asignadoANombre === 'string') {
                encargadosArr = data.asignadoANombre.split(',').map(s => s.trim()).filter(Boolean);
            }

            const acompanantesTxt = acompanantesArr.join(', ') || 'Nadie';
            const encargadosTxt = encargadosArr.join(', ') || 'Ninguno';

            let proyectoLinks = '';
            let proyectoNombre = 'Ninguno';
            if (data.proyectoId) {
                const proj = await CRMProyecto.findById(data.proyectoId);
                if (proj) {
                    proyectoNombre = `${proj.folio || 'S/F'} - ${proj.nombre}`;
                    if (proj.archivos && proj.archivos.length > 0) {
                        const DOMAIN = process.env.URL || 'https://crm-production-2af7.up.railway.app';
                        const linksStr = proj.archivos.map(a => `${DOMAIN}${a}`).join('\n');
                        proyectoLinks = `\n\n📄 *Documentos del Proyecto:*\n${linksStr}`;
                    }
                }
            }

            const fechaTxt = data.fechaVencimiento ? new Date(data.fechaVencimiento).toISOString().split('T')[0] : 'No definida';
            const mensajeBase = `📝 Tarea: ${data.descripcion}\n📅 Fecha: ${fechaTxt}\n🕒 Horario: ${data.horaInicio || 'No definido'} a ${data.horaFin || 'No definido'}\n🏗️ Proyecto: ${proyectoNombre}\n🚗 Vehículo(s): ${vehiculosNombres}${proyectoLinks}\n\n⚠️ Por favor responde con la palabra *"Enterado"* para confirmar de recibido.`;

            for (const enc of encargadosArr) {
                const telEncargado = findPhone(enc);
                if (typeof waLog !== 'undefined' && waLog.add) {
                    waLog.add(`🔍 Buscando tel para encargado: ${enc} -> Resultado: ${telEncargado || 'NO ENCONTRADO'}`);
                }
                if (telEncargado) {
                    const msgEncargado = `🚨 *NUEVA TAREA ASIGNADA (Tú eres el Encargado)* 🚨\n\n${mensajeBase}\n\n👥 Te acompañan: ${acompanantesTxt}`;
                    try { await sendWhatsAppMessage(telEncargado, msgEncargado); } catch(e) { console.error('Error WA encargado:', e); }
                }
            }

            for (const ac of acompanantesArr) {
                const telAc = findPhone(ac);
                if (typeof waLog !== 'undefined' && waLog.add) {
                    waLog.add(`🔍 Buscando tel para acompañante: ${ac} -> Resultado: ${telAc || 'NO ENCONTRADO'}`);
                }
                if (telAc) {
                    const msgAc = `🔔 *NUEVA TAREA ASIGNADA (Vas como Acompañante)* 🔔\n\n👤 Encargado principal: ${encargadosTxt || 'Ninguno'}\n\n${mensajeBase}`;
                    try { await sendWhatsAppMessage(telAc, msgAc); } catch(e) { console.error('Error WA acompañante:', e); }
                }
            }

        } catch (e) {
            console.error("Error generando notificaciones WA desde CRM:", e);
            if (typeof waLog !== 'undefined' && waLog.add) {
                waLog.add(`❌ CRITICAL ERROR notificaciones: ${e.message}`);
            }
        }
        }); // fin setImmediate
        // --- FIN NOTIFICACIONES ---
    } catch(err) { res.status(500).json({error: err.message}); }
});
app.put('/api/actividades/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        // Ajuste de zona horaria para evitar desfase de 1 día (forzar mediodía UTC)
        if (data.fechaVencimiento && typeof data.fechaVencimiento === 'string' && data.fechaVencimiento.length === 10) {
            data.fechaVencimiento = data.fechaVencimiento + 'T12:00:00.000Z';
        }
        
        const updatedAct = await CRMActividad.findByIdAndUpdate(id, data, { new: true });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        
        if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
            let label = data.destinoSugeridoCRMText || data.descripcion || 'Tarea de CRM';
            for (const vId of data.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { destinoSugeridoCRM: label });
            }
        }
        res.json({ message: 'Actividad actualizada con éxito', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/actividades/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, comentarioCierre } = req.body;
        let updateData = { estado };
        if (comentarioCierre) updateData.comentarioCierre = comentarioCierre;
        const updatedAct = await CRMActividad.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        res.json({ message: 'Estado actualizado', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/actividades/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedAct = await CRMActividad.findByIdAndDelete(id);
        if (!deletedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        
        if (deletedAct.vehiculosAsignados && deletedAct.vehiculosAsignados.length > 0) {
            for (const vId of deletedAct.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { $unset: { destinoSugeridoCRM: 1 } });
            }
        }

        res.json({ message: 'Actividad eliminada' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Rutas de Eventos (Agenda)
app.get('/api/eventos', async (req, res) => {
    try {
        const evs = await CRMEvento.find().sort({ fechaInicio: 1 });
        res.json(evs);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/eventos', async (req, res) => {
    try {
        const data = req.body;
        const ev = new CRMEvento(data);
        await ev.save();
        res.json({ message: 'Evento creado', data: ev });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await CRMEvento.findByIdAndDelete(id);
        res.json({ message: 'Evento eliminado' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// INTEGRACION WHATSAPP-WEB.JS - NAIS BOT
// ==========================================
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const QRCode = require('qrcode');

// Schema para persistir sesiones del bot WA en MongoDB (sobrevive reinicios)
const WaSessionSchema = new mongoose.Schema({
    chatId: { type: String, unique: true },
    state: { type: String, default: 'IDLE' },
    ctx: { type: Object, default: {} },
    updatedAt: { type: Date, default: Date.now, expires: 86400 } // TTL 24h
}, { collection: 'wa_bot_sessions' });
const WaSession = mongoose.model('WaSession', WaSessionSchema);

// Helpers async para sesiones persistentes
async function getSession(chatId) {
    try {
        const s = await WaSession.findOne({ chatId }).lean();
        return s || { state: 'IDLE', ctx: {} };
    } catch(e) { return { state: 'IDLE', ctx: {} }; }
}
async function setSession(chatId, data) {
    try {
        await WaSession.findOneAndUpdate(
            { chatId },
            { state: data.state, ctx: data.ctx || {}, updatedAt: new Date() },
            { upsert: true, returnDocument: 'after' }
        );
    } catch(e) { waLog.add(`⚠️ Error guardando sesión: ${e.message?.substring(0,60)}`); }
}

// ==========================================
// REGISTRO INTERNO: LID → chatId real
// Proceso aislado que SOLO resuelve el identificador LID de WhatsApp
// al número de teléfono real (ej. 52133...@c.us).
// No interfiere con ninguna otra lógica del bot.
// ==========================================
const lidToChatId = new Map(); // lid@lid  →  521XXXXXXXXXX@c.us

let waCurrentQR = null;
let waStatus = 'DESCONECTADO';

// WA_DATA_PATH = './' es necesario porque wwebjs-mongo escribe el ZIP en process.cwd()
// Con la sesión vacía en MongoDB, RemoteAuth genera QR directamente (sin ENOENT)
const WA_DATA_PATH = './';
try { fs.mkdirSync(WA_DATA_PATH, { recursive: true }); } catch(_) {}

// Bandera para evitar múltiples instancias de Puppeteer simultáneas
let waInitializing = false;


const initWhatsApp = () => {
    if (waInitializing) {
        waLog.add('⚠️ Ya hay un init en progreso, ignorando llamada duplicada...');
        return;
    }
    waInitializing = true;
    waLog.add('🔄 Iniciando RemoteAuth con MongoDB...');
    const store = new MongoStore({ mongoose: mongoose });
    
    waClient = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'nais-crm',
            store: store,
            backupSyncIntervalMs: 600000,
            dataPath: WA_DATA_PATH
        }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-extensions',
            ],
            protocolTimeout: 120000,
            timeout: 120000
        }
    });

    waClient.on('qr', (qr) => {
        waInitializing = false; // Puppeteer arrancó correctamente
        waCurrentQR = qr;
        waStatus = 'ESPERANDO_ESCANEO';
        waLog.add('📱 QR generado - esperando escaneo');
    });

    waClient.on('ready', () => {
        waInitializing = false;
        waCurrentQR = null;
        waStatus = 'CONECTADO';
        waReady = true;
        waLog.ultimaActividad = new Date();
        waLog.add('✅ Bot conectado y listo');
    });

    waClient.on('remote_session_saved', () => {
        waLog.add('✅ SESIÓN GUARDADA EN MONGO ATLAS');
        console.log('✅ SESIÓN GUARDADA EN MONGO ATLAS');
    });

    waClient.on('disconnected', async (reason) => {
        waInitializing = false;
        waStatus = 'DESCONECTADO';
        waReady = false;
        waLog.add(`❌ Desconectado: ${reason}`);
        waLog.ultimoError = `Desconectado: ${reason}`;
        
        waLog.add('🔄 Reiniciando bot en 15 segundos...');
        setTimeout(async () => {
            try {
                waLog.add('🔄 Destruyendo cliente anterior...');
                try { await waClient.destroy(); } catch(_) {}
                waClient = null;
            } catch(_) {}
            waLog.add('🔄 Creando nuevo cliente WhatsApp...');
            initWhatsApp();
        }, 15000);
    });

    waClient.on('auth_failure', async (msg) => {
        waInitializing = false;
        waStatus = 'ERROR_AUTH';
        waReady = false;
        waLog.add(`🔐 Error de autenticación: ${msg}`);
        waLog.ultimoError = `Auth failure: ${msg}`;
        waLog.add('🔄 Reiniciando tras auth_failure en 20 segundos...');
        setTimeout(async () => {
            try { await waClient.destroy(); } catch(_) {}
            waClient = null;
            initWhatsApp();
        }, 20000);
    });

// Endpoint para ver el QR como imagen desde el navegador
// Helper para convertir telefono a formato WA
async function getChatIdFromPhone(phone) {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
    if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
    return cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
}

// Endpoint interactivo para la asignación de vehículos — Mensaje mejorado con foto y términos
app.post('/api/whatsapp/asignacion-vehiculo', async (req, res) => {
    try {
        const { txId, vehicleId, userName, marca, modelo, placas, bitacoraRevisada, checklistNotas, equipmentPhotoUrl, mainApiUrl } = req.body;
        const allUsers = await UserRef.find();
        const queryName = userName.trim().toLowerCase().replace(/\s+/g, ' ');
        const u = allUsers.find(x => {
            const fullName = `${(x.nombre||'').trim()} ${(x.apellido||'').trim()}`.trim().toLowerCase().replace(/\s+/g, ' ');
            if (!fullName) return false;
            return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
        });

        if (u && u.telefono) {
            const kitTxt = (bitacoraRevisada && bitacoraRevisada.length > 0)
                ? bitacoraRevisada.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
                : '  (Sin herramientas)';

            // --- Mensaje principal ---
            const msg =
`🚗 *VEHÍCULO PRE-ASIGNADO*

*${(marca || '').toUpperCase()} ${modelo}*
Placas: *${placas || 'S/P'}*

📦 *Equipamiento:*
${kitTxt}
${checklistNotas ? `\n📝 Notas: ${checklistNotas}` : ''}

─────────────────────
📋 *TÉRMINOS Y CONDICIONES:*
Al aceptar, confirmas la recepción del vehículo y su equipamiento en el estado descrito. Eres responsable de su resguardo y uso adecuado durante el período de asignación.
─────────────────────

Responde con una de estas palabras:
✅ *ACEPTAR* — para recibir el vehículo
❌ *RECHAZAR* — para declinar la asignación`;

            // --- Enviar foto del equipo primero (si existe) ---
            if (equipmentPhotoUrl && waClient && waReady) {
                try {
                    const { MessageMedia } = require('whatsapp-web.js');
                    let mediaObj = null;

                    if (equipmentPhotoUrl.startsWith('data:')) {
                        // Base64 inline
                        const [metaPart, dataPart] = equipmentPhotoUrl.split(',');
                        const mimeType = metaPart.match(/:(.*?);/)?.[1] || 'image/jpeg';
                        mediaObj = new MessageMedia(mimeType, dataPart, 'equipo_vehiculo.jpg');
                    } else {
                        // URL externa — descargar
                        mediaObj = await MessageMedia.fromUrl(equipmentPhotoUrl, { unsafeMime: true });
                    }

                    if (mediaObj) {
                        let cleanPhone = u.telefono.replace(/\D/g, '');
                        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
                        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
                        const chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
                        await waClient.sendMessage(chatId, mediaObj, { caption: `📸 Foto del equipamiento del vehículo *${modelo}* (${placas})` });
                    }
                } catch (photoErr) {
                    waLog.add(`⚠️ No se pudo enviar foto equipo: ${photoErr.message?.substring(0,60)}`);
                }
            }

            // --- Enviar mensaje de texto ---
            await sendWhatsAppMessage(u.telefono, msg);

            // --- Guardar sesión para respuesta ---
            const chatId = await getChatIdFromPhone(u.telefono);
            if (chatId) {
                const altChatId = chatId.startsWith('521') ? chatId.replace('521', '52') : chatId.replace('52', '521');
                const sessionData = { state: 'WAITING_VEHICLE_CONFIRM', ctx: { txId, vehicleId, mainApiUrl: mainApiUrl || 'https://entregables-production-b834.up.railway.app' } };
                await setSession(chatId, sessionData);
                await setSession(altChatId, sessionData);
                waLog.add(`📋 Sesión WAITING_VEHICLE_CONFIRM guardada para ${chatId}`);
            }
        }
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/whatsapp/send', async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || !message) return res.status(400).json({ error: "Falta 'to' o 'message'" });
        await sendWhatsAppMessage(to, message);
        res.json({ success: true, message: "Mensaje de WhatsApp enviado" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/whatsapp/qr', async (req, res) => {
    if (waStatus === 'CONECTADO') {
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#4ade80"><h1>✅ WhatsApp Conectado</h1><p>El bot ya está vinculado y funcionando.</p></body></html>`);
    }
    if (!waCurrentQR) {
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#f59e0b"><h1>⏳ Generando QR...</h1><p>Estado: ${waStatus}</p><p>Recarga esta página en unos segundos.</p><script>setTimeout(()=>location.reload(), 3000)</script></body></html>`);
    }
    try {
        const qrImageUrl = await QRCode.toDataURL(waCurrentQR, { width: 300, margin: 2 });
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NAIS WhatsApp QR</title><style>body{background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;font-family:sans-serif;color:white}h1{margin-bottom:10px;color:#6366f1}p{color:#94a3b8;margin-bottom:20px}img{border-radius:12px;box-shadow:0 0 30px rgba(99,102,241,0.5)}</style><meta http-equiv="refresh" content="30"></head><body><h1>📱 Escanea con WhatsApp</h1><p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p><img src="${qrImageUrl}" width="300" /><p style="margin-top:15px;font-size:0.8rem">Esta página se actualiza automáticamente cada 30 segundos</p></body></html>`);
    } catch (e) {
        res.status(500).send('Error generando QR');
    }
});

// Panel de diagnostico en tiempo real
app.get('/whatsapp/status', (req, res) => {
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime/3600), m = Math.floor((uptime%3600)/60), s = uptime%60;
    const statusColor = waStatus === 'CONECTADO' ? '#4ade80' : waStatus === 'ESPERANDO_ESCANEO' ? '#f59e0b' : '#f87171';
    const statusIcon = waStatus === 'CONECTADO' ? '\u2705' : waStatus === 'ESPERANDO_ESCANEO' ? '\u23f3' : '\u274c';
    const ultimaAct = waLog.ultimaActividad ? waLog.ultimaActividad.toLocaleString('es-MX',{timeZone:'America/Mexico_City'}) : 'Nunca';
    const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const historialHTML = waLog.historial.map(l => `<div style="padding:4px 0;border-bottom:1px solid #1e293b;font-size:0.85rem">${esc(l)}</div>`).join('') || '<div style="color:#64748b">Sin actividad registrada</div>';
    const errorHTML = waLog.errores.length > 0
        ? waLog.errores.map(e => `<div style="padding:6px 0;border-bottom:1px solid #2d1515;white-space:pre-wrap;word-break:break-all">${esc(e)}</div>`).join('')
        : '<div style="color:#4ade80">\u2705 Sin errores registrados</div>';
    const css = `body{background:#0f172a;font-family:sans-serif;color:#e2e8f0;padding:30px;margin:0}h1{color:#6366f1;margin-bottom:5px}.card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:15px}.label{color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.value{font-size:1.1rem;font-weight:600}.status-badge{display:inline-block;padding:6px 16px;border-radius:99px;font-weight:700;font-size:1rem;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px}.scroll{max-height:360px;overflow-y:auto}.errlog{font-family:monospace;font-size:0.78rem;line-height:1.6;color:#fca5a5}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NAIS Bot - Status</title><meta http-equiv="refresh" content="15"><style>${css}</style></head><body>
<h1>\ud83e\udd16 NAIS Bot - Panel de Estado</h1>
<p style="color:#64748b;margin-top:0">Se actualiza cada 15 segundos</p>
<div class="card"><div class="label">Estado del Bot</div><div style="margin-top:8px"><span class="status-badge">${statusIcon} ${waStatus}</span></div></div>
<div class="grid">
  <div class="card"><div class="label">Uptime del Servidor</div><div class="value">${h}h ${m}m ${s}s</div></div>
  <div class="card"><div class="label">\u00daltima Conexi\u00f3n</div><div class="value" style="font-size:0.9rem">${ultimaAct}</div></div>
  <div class="card"><div class="label">\u00daltimo Mensaje</div><div class="value" style="font-size:0.9rem">${waLog.ultimoMensaje || 'Ninguno'}</div></div>
</div>
<div class="card" style="border:1px solid #f8717166">
  <div class="label" style="color:#f87171">\ud83d\udd34 LOG DE ERRORES REALES \u2014 ${waLog.errores.length} capturados &nbsp;<a href="/whatsapp/errors" target="_blank" style="color:#6366f1;font-size:0.78rem;font-weight:normal">[ Ver JSON ]</a></div>
  <div class="scroll errlog" style="margin-top:10px">${errorHTML}</div>
</div>
<div class="card"><div class="label">Historial de Eventos (\u00faltimos 30)</div><div class="scroll" style="margin-top:10px">${historialHTML}</div></div>
${waStatus !== 'CONECTADO' ? '<div style="text-align:center;margin-top:15px"><a href="/whatsapp/qr" style="background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">\ud83d\udcf1 Ir a escanear QR</a></div>' : ''}
</body></html>`);
});

// Endpoint JSON de errores — diagnostico completo con stack traces
app.get('/whatsapp/errors', (req, res) => {
    res.json({
        total: waLog.errores.length,
        ultimoError: waLog.ultimoError,
        errores: waLog.errores
    });
});

// ─── DIAGNÓSTICO: ver si la sesión existe en MongoDB GridFS ───
app.get('/whatsapp/session-check', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        let result = { sessionExists: false, files: [], chunks: 0, waStatus, waInitializing, waReady };
        
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name);
        result.collections = colNames.filter(n => n.includes('whatsapp'));
        
        if (colNames.includes('whatsapp-nais-crm.files')) {
            const files = await db.collection('whatsapp-nais-crm.files').find({}).toArray();
            result.files = files.map(f => ({ _id: f._id, filename: f.filename, length: f.length, uploadDate: f.uploadDate }));
            result.sessionExists = files.length > 0;
        }
        if (colNames.includes('whatsapp-nais-crm.chunks')) {
            result.chunks = await db.collection('whatsapp-nais-crm.chunks').countDocuments();
        }
        
        res.json(result);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});
// ──────────────────────────────────────────────────────────────

// Endpoint para cerrar sesión, limpiar BD y generar nuevo QR
app.get('/whatsapp/reset', async (req, res) => {
    try {
        if (waClient) {
            try { await waClient.logout(); } catch(e) {}
            try { await waClient.destroy(); } catch(e) {}
        }
        
        waReady = false;
        waStatus = 'DESCONECTADO';
        waCurrentQR = null;

        // Forzar borrado de la colección de RemoteAuth en MongoDB (GridFS)
        try {
            await mongoose.connection.db.collection('whatsapp-nais-crm.files').drop();
            await mongoose.connection.db.collection('whatsapp-nais-crm.chunks').drop();
        } catch(e) { /* Ignorar si no existen */ }

        // Forzar borrado de carpeta local temporal
        try {
            fs.rmSync(WA_DATA_PATH, { recursive: true, force: true });
            fs.mkdirSync(WA_DATA_PATH, { recursive: true });
        } catch(e) {}

        // Reiniciar el bot limpiamente
        setTimeout(() => {
            initWhatsApp();
        }, 5000);

        res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#4ade80">
            <h1>✅ Limpieza Profunda Completada</h1>
            <p>Se ha borrado la sesión de la nube y del servidor local.</p>
            <p>El bot se está reiniciando en segundo plano...</p>
            <p>Regresa a la pestaña de QR en unos 15 a 30 segundos, debería aparecer el nuevo código listo para escanear.</p>
            <script>setTimeout(()=>window.location.href='/whatsapp/qr', 10000)</script>
            </body></html>`);
    } catch(e) {
        res.status(500).send('Error al limpiar la sesión: ' + e.message);
    }
});



const waMessageHandler = async message => {
    try {
        const From = message.from; 
        const Body = message.body;

        if (!Body || !From || From.includes('@g.us') || From === 'status@broadcast') return; // ignorar grupos y estados

        // -------------------------------------------------------
        // RESOLUCIÓN DE LID → chatId real (proceso interno aislado)
        // WhatsApp a veces entrega mensajes con From = "XXXXXX@lid"
        // en lugar del número real ("521...@c.us").
        // Aquí actualizamos el mapa y derivamos el From correcto.
        // -------------------------------------------------------
        let resolvedFrom = From;
        if (From.endsWith('@lid')) {
            // Si ya conocemos este LID, lo resolvemos de inmediato
            if (lidToChatId.has(From)) {
                resolvedFrom = lidToChatId.get(From);
                waLog.add(`🔗 LID resuelto: ${From} → ${resolvedFrom}`);
            } else {
                // Intentamos obtener el contacto para registrar su número real
                try {
                    const contact = await message.getContact();
                    if (contact && contact.id && contact.id._serialized && !contact.id._serialized.endsWith('@lid')) {
                        resolvedFrom = contact.id._serialized;
                        lidToChatId.set(From, resolvedFrom);
                        waLog.add(`🔗 LID registrado: ${From} → ${resolvedFrom}`);
                    } else if (contact && contact.number) {
                        // Fallback: construir chatId desde el número
                        let num = contact.number.replace(/\D/g, '');
                        if (num.length === 10) num = `521${num}`;
                        resolvedFrom = `${num}@c.us`;
                        lidToChatId.set(From, resolvedFrom);
                        waLog.add(`🔗 LID registrado (número): ${From} → ${resolvedFrom}`);
                    }
                } catch(e) {
                    waLog.add(`⚠️ No se pudo resolver LID ${From}: ${e.message?.substring(0,50)}`);
                }
            }
        } else {
            // Mensaje normal: guardar la relación por si en el futuro llega como LID
            // (registramos todos los chatIds que no sean LID para lookup inverso futuro)
            // No hacemos nada extra, solo dejamos pasar
        }
        // -------------------------------------------------------

        // Registrar actividad
        waLog.ultimoMensaje = new Date().toLocaleString('es-MX', {timeZone:'America/Mexico_City'});
        waLog.ultimaActividad = new Date();
        waLog.add(`💬 Mensaje de ${From.replace('@c.us','').replace('@lid','(lid)')}: "${Body.substring(0,40)}${Body.length>40?'...':''}"`);

        // Helper local: usa reply() que es más confiable que sendMessage()
        const reply = async (text) => {
            try {
                await message.reply(text);
            } catch (e) {
                waLog.add(`⚠️ Error reply: ${e.message.substring(0,60)}`);
                // Fallback: intentar con sendMessage
                try {
                    const chat = await message.getChat();
                    await chat.sendMessage(text);
                } catch (e2) {
                    console.error('Error fallback sendMessage:', e2.message);
                }
            }
        };

        const text = Body.trim().toLowerCase();

        // Cargar sesión desde MongoDB usando el chatId resuelto (no el LID crudo)
        const effectiveFrom = resolvedFrom;
        const altFrom = effectiveFrom.startsWith('521') ? effectiveFrom.replace('521', '52') : effectiveFrom.replace(/^52/, '521');
        
        const s = await getSession(effectiveFrom);
        const sFromAlt = await getSession(altFrom);
        
        // Si la sesión principal está IDLE pero la variante tiene estado activo, migrar y limpiar la variante
        if (s.state === 'IDLE' && sFromAlt && sFromAlt.state !== 'IDLE') {
            Object.assign(s, sFromAlt);
            await setSession(effectiveFrom, s);
            await setSession(altFrom, { state: 'IDLE', ctx: {} });
        }
        
        // Cancelación Global (más flexible)
        if (text.includes('cancelar') || text === 'cancela' || text === 'salir' || text === 'reiniciar' || text.includes('abortar')) {
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
            await setSession(altFrom, { state: 'IDLE', ctx: {} }); // Limpiar también la variante por seguridad
            await reply("🚫 *Operación cancelada.*\n\n¿En qué más te puedo ayudar?");
            return;
        }

        // --- AUTOCLEANUP: Revisar si la confirmación pendiente sigue siendo válida ---
        if (s.state === 'WAITING_VEHICLE_CONFIRM' && s.ctx.txId) {
            try {
                const tx = await VehicleTransactionRef.findById(s.ctx.txId);
                let invalid = false;
                if (!tx) invalid = true;
                else {
                    // Si ya no está "Pendiente" o si el vehículo ya fue devuelto
                    if (tx.estadoConfirmacion && tx.estadoConfirmacion !== 'Pendiente' && tx.estadoConfirmacion !== 'Pendiente Confirmación') {
                        invalid = true;
                    }
                    if (!invalid && tx.vehicleId) {
                        const veh = await VehicleRef.findById(tx.vehicleId);
                        if (!veh || veh.estado !== 'Prestado') {
                            invalid = true; // El vehículo ya no está prestado, fue devuelto
                        }
                    }
                }
                
                if (invalid) {
                    s.state = 'IDLE';
                    s.ctx = {};
                    await setSession(effectiveFrom, s);
                    waLog.add(`🧹 Auto-Limpieza: La sesión de ${effectiveFrom} estaba esperando confirmación de vehículo pero la transacción ya no es válida.`);
                }
            } catch (e) {
                console.error("Error validando sesión atascada:", e);
            }
        }

        if (s.state === 'IDLE') {
            const esLevantamiento = text.includes('levantamiento');
            const esCita = text.includes('cita') || text.includes('junta') || text.includes('reunion') || text.includes('reunión');
            const esTarea = text.includes('tarea') || text.includes('actividad') || text.includes('asignar');
            const esAvance = text.includes('avance') || text.includes('reportar');
            const esEnterado = text === 'enterado' || text === 'enterada' || text.includes('enterado');
            
            if (esEnterado) {
                await reply(`✅ *Confirmado*. He registrado que estás enterado de tus asignaciones.\n\nRecuerda que para reportar tu progreso puedes escribir la palabra *"avance"*.`);
                return;
            } else if (esAvance) {
                const proyectosActivos = await CRMProyecto.find({ estado: { $in: ['Activo', 'Pausado'] } }).sort({ fechaInicio: -1 });
                let proyList = [];
                let pNum = 1;
                proyectosActivos.forEach(p => { proyList.push({ num: pNum++, folio: p.folio, nombre: p.nombre, id: p._id.toString() }); });
                s.ctx.proyList = proyList;
                
                let proysTxt = proyList.length > 0 ? proyList.map(p => `${p.num}. [${p.folio || 'S/F'}] ${p.nombre}`).join('\n') : 'No hay proyectos activos.';
                
                s.state = 'WAITING_AVANCE_PROYECTO';
                await setSession(effectiveFrom, s);
                await reply(`📊 *REPORTAR AVANCE*\n\n${proysTxt}\n\n¿A qué *PROYECTO* deseas reportarle avance?\n(Escribe el número)`);
            } else if (esLevantamiento || esCita) {
                s.ctx.type = esLevantamiento ? 'Levantamiento' : 'Junta';
                s.ctx.isEvento = true;
                s.state = 'WAITING_TAREA_DESC';
                await setSession(effectiveFrom, s);
                await reply(`📅 Claro, vamos a agendar tu ${s.ctx.type}.\n\n¿Cuál es la descripción, el cliente o el asunto principal?`);
            } else if (esTarea) {
                s.ctx.isEvento = false;
                s.state = 'WAITING_TAREA_DESC';
                await setSession(effectiveFrom, s);
                await reply(`🛠️ Vamos a asignar una *Nueva Tarea*.\n\n¿Cuál es la descripción o nombre de la actividad?`);
            } else {
                await reply("🤖 ¡Hola! Soy NAIS desde tu CRM.\n\nPuedo ayudarte a:\n- Agendar *juntas*, *citas* o *levantamientos*\n- Asignar *tareas* al equipo\n- *Reportar avance* de un proyecto\n\n¿Qué deseas hacer?");
            }
        } else if (s.state === 'WAITING_AVANCE_PROYECTO') {
            const num = parseInt(text.trim());
            const proy = (s.ctx.proyList || []).find(p => p.num === num);
            if (!proy) return reply(`⚠️ Número no válido. Por favor, escribe un número de la lista.`);
            s.ctx.proyectoId = proy.id;
            s.ctx.proyecto = proy.nombre;
            
            const tareas = await CRMActividad.find({ proyectoId: proy.id, estado: { $ne: 'Completada' } });
            let tareasList = [];
            let tNum = 1;
            tareas.forEach(t => { tareasList.push({ num: tNum++, desc: t.descripcion, id: t._id.toString() }); });
            s.ctx.tareasList = tareasList;
            
            if (tareasList.length > 0) {
                let txt = tareasList.map(t => `${t.num}. ${t.desc}`).join('\n');
                s.state = 'WAITING_AVANCE_TAREA';
                await setSession(effectiveFrom, s);
                await reply(`🛠️ *TAREAS DEL PROYECTO*\n\n${txt}\n\n¿A qué *TAREA* le reportarás avance?\n(Escribe el número, o "0" para reportar al proyecto en general sin especificar tarea)`);
            } else {
                s.ctx.tareaId = null;
                s.state = 'WAITING_AVANCE_PCT_TAREA';
                await setSession(effectiveFrom, s);
                await reply(`No hay tareas pendientes en este proyecto.\n\n¿Cuál es el *Porcentaje de Avance* de tu actividad? (1-100)`);
            }
        } else if (s.state === 'WAITING_AVANCE_TAREA') {
            const num = parseInt(text.trim());
            if (num === 0) {
                s.ctx.tareaId = null;
                s.ctx.tareaDesc = 'General';
            } else {
                const t = (s.ctx.tareasList || []).find(x => x.num === num);
                if (!t) return reply(`⚠️ Número no válido. Escribe un número de la lista o "0".`);
                s.ctx.tareaId = t.id;
                s.ctx.tareaDesc = t.desc;
            }
            s.state = 'WAITING_AVANCE_PCT_TAREA';
            await setSession(effectiveFrom, s);
            await reply(`📈 Tarea: ${s.ctx.tareaDesc || 'General'}\n\n¿Cuál es el *Porcentaje de Avance* de esta actividad? (Escribe un número del 1 al 100)`);
        } else if (s.state === 'WAITING_AVANCE_PCT_TAREA') {
            const num = parseInt(text.trim());
            if (isNaN(num) || num < 0 || num > 100) return reply(`⚠️ Porcentaje inválido. Escribe un número del 1 al 100.`);
            s.ctx.pctTarea = num;
            s.state = 'WAITING_AVANCE_PCT_PROY';
            await setSession(effectiveFrom, s);
            await reply(`📈 Enterado (${num}%).\n\n¿Cuál es el nuevo *Porcentaje Global del Proyecto* aportado? (1-100)`);
        } else if (s.state === 'WAITING_AVANCE_PCT_PROY') {
            const num = parseInt(text.trim());
            if (isNaN(num) || num < 0 || num > 100) return reply(`⚠️ Porcentaje inválido. Escribe un número del 1 al 100.`);
            s.ctx.pctProy = num;
            s.state = 'WAITING_AVANCE_DESC';
            await setSession(effectiveFrom, s);
            await reply(`📝 Enterado (${num}%).\n\nEscribe un *Comentario o Descripción* del trabajo que se realizó hoy:`);
        } else if (s.state === 'WAITING_AVANCE_DESC') {
            s.ctx.comentario = Body.trim();
            s.ctx.fotos = [];
            s.state = 'WAITING_AVANCE_FOTOS';
            await setSession(effectiveFrom, s);
            await reply(`📸 Comentario guardado.\n\nPor último, puedes enviar hasta *5 FOTOS* de evidencia ahora mismo.\n\n(Las fotos se procesarán una por una). Cuando hayas terminado de enviar fotos, o si no enviarás ninguna, escribe *"listo"*.`);
        } else if (s.state === 'WAITING_AVANCE_FOTOS') {
            const finishAvanceLocal = async () => {
                try {
                    const proj = await CRMProyecto.findById(s.ctx.proyectoId);
                    if (!proj) throw new Error("Proyecto no encontrado");
                    
                    const user = await UserRef.findOne({ telefono: { $regex: effectiveFrom.split('@')[0] } });
                    const empName = user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Trabajador WA';
                    
                    proj.avances.push({
                        empleado: empName,
                        porcentaje: s.ctx.pctTarea || 0,
                        porcentajeProyecto: s.ctx.pctProy || 0,
                        comentario: s.ctx.comentario,
                        fotos: s.ctx.fotos || []
                    });
                    if (s.ctx.pctProy > 0) {
                        proj.porcentajeAvance = s.ctx.pctProy;
                    }
                    await proj.save();
                    
                    if (s.ctx.tareaId) {
                        await CRMActividad.findByIdAndUpdate(s.ctx.tareaId, {
                            porcentajeAvance: s.ctx.pctTarea,
                            avanceReportado: true,
                            estado: s.ctx.pctTarea >= 100 ? 'Completada' : 'En Progreso'
                        });
                    }
                    
                    await reply(`✅ *AVANCE REPORTADO EXITOSAMENTE*\n\n🏗️ Proyecto: ${proj.nombre}\n📈 Tarea: ${s.ctx.pctTarea}% | Proyecto: ${s.ctx.pctProy}%\n📝 ${s.ctx.comentario}\n📸 Fotos: ${(s.ctx.fotos || []).length}\n\nEl panel operativo ha sido actualizado.`);
                } catch(e) {
                    console.error("Error finalizando avance WA:", e);
                    await reply(`❌ Error al guardar el avance. Consulta al administrador.`);
                }
                await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
            };

            if (message.hasMedia) {
                try {
                    const media = await message.downloadMedia();
                    if (media && media.mimetype.startsWith('image/')) {
                        const fs = require('fs');
                        const path = require('path');
                        const ext = media.mimetype.split('/')[1] || 'jpeg';
                        const fileName = `wa_evidencia_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
                        const filePath = path.join(__dirname, 'public', 'archivos', fileName);
                        fs.writeFileSync(filePath, media.data, 'base64');
                        s.ctx.fotos = s.ctx.fotos || [];
                        s.ctx.fotos.push(`archivos/${fileName}`);
                        await setSession(effectiveFrom, s);
                        
                        if (s.ctx.fotos.length >= 5) {
                            await reply(`✅ Límite de 5 fotos alcanzado. Procesando avance...`);
                            await finishAvanceLocal();
                        } else {
                            // acknowledge receipt silently or minimally
                            waLog.add(`✅ Foto recibida de WA para avance. (${s.ctx.fotos.length}/5)`);
                        }
                    } else {
                        await reply(`⚠️ Por favor envía una imagen válida, o escribe "listo" para terminar.`);
                    }
                } catch(e) {
                    console.error("Error descargando foto wa:", e);
                    await reply(`❌ Error recibiendo la imagen.`);
                }
            } else if (text === 'listo' || text === 'terminar') {
                await reply(`⏳ Procesando avance...`);
                await finishAvanceLocal();
            } else {
                await reply(`⚠️ Por favor envía fotos de evidencia o escribe *"listo"* para finalizar el reporte.`);
            }
        } else if (s.state === 'WAITING_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TIME';
            await setSession(effectiveFrom, s);
            await reply(`Perfecto, anotado para: *${s.ctx.dateStr}*.\n\n¿A qué hora sería?\n(Si no hay hora definida, responde "ninguna")`);
        } else if (s.state === 'WAITING_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_DESC';
            await setSession(effectiveFrom, s);
            await reply(`Enterado.\n\n¿Cuál es la descripción, el cliente o el proyecto de este ${s.ctx.type}?`);
        } else if (s.state === 'WAITING_DESC') {
            s.ctx.desc = Body.trim();
            
            // Obtener fecha actual en la zona horaria de México para evitar desfase de UTC (ej. si es 23:58 local, el servidor en UTC ya es mañana)
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            if (s.ctx.dateStr.toLowerCase().includes('mañana') || s.ctx.dateStr.toLowerCase().includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            } else if (s.ctx.dateStr.toLowerCase().includes('pasado')) {
                fecha.setDate(fecha.getDate() + 2);
            }
            
            try {
                const ev = new CRMEvento({
                    tipo: s.ctx.type,
                    titulo: `[WA] ${s.ctx.type} - ${s.ctx.desc}`,
                    descripcion: `Hora solicitada: ${s.ctx.timeStr} | Fecha indicada: ${s.ctx.dateStr}\n(Agendado vía WhatsApp)`,
                    fechaInicio: fecha,
                    fechaFin: new Date(fecha.getTime() + 60*60*1000)
                });
                await ev.save();
                await reply(`✅ ¡Listo! Tu ${s.ctx.type} ha sido agendado en el CRM exitosamente.\n\n*Detalles:*\n📝 ${s.ctx.desc}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr}\n\nPara agendar algo más, solo escríbeme.`);
            } catch(e) {
                console.error('Error guardando evento WA:', e);
                await reply(`Ocurrió un error al guardar. Intenta de nuevo diciendo "cancelar".`);
            }
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
        } 
        // --- FLUJO TAREAS ---
        else if (s.state === 'WAITING_TAREA_DESC') {
            s.ctx.desc = Body.trim();
            s.state = 'WAITING_TAREA_DATE';
            await setSession(effectiveFrom, s);
            await reply(`📝 Tarea: *${s.ctx.desc}*\n\n¿Para qué fecha es la tarea? (Ej: Mañana, hoy, 25/05/2026)`);
        } else if (s.state === 'WAITING_TAREA_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME';
            await setSession(effectiveFrom, s);
            await reply(`🗓️ Fecha: *${s.ctx.dateStr}*\n\n¿A qué hora *Inicia*? (Formato 24h, ej: 09:00 o 14:30)`);
        } else if (s.state === 'WAITING_TAREA_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME_END';
            await setSession(effectiveFrom, s);
            await reply(`⏰ Inicio: ${s.ctx.timeStr}\n\n¿A qué hora *Termina*? (Ej: 13:00). Si no tiene fin, responde "no".`);
        } else if (s.state === 'WAITING_TAREA_TIME_END') {
            s.ctx.timeEndStr = Body.trim().toLowerCase() === 'no' ? null : Body.trim();
            
            // Calc Date
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            if (s.ctx.dateStr.toLowerCase().includes('mañana') || s.ctx.dateStr.toLowerCase().includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            } else if (s.ctx.dateStr.toLowerCase().includes('pasado')) {
                fecha.setDate(fecha.getDate() + 2);
            }
            s.ctx.parsedFecha = fecha;
            
            const fechaBase = fecha.toISOString().split('T')[0];
            const diaInicio = new Date(fechaBase + 'T00:00:00.000Z');
            const diaFin   = new Date(fechaBase + 'T23:59:59.999Z');
            
            try {
                const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });
                const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

                let ocupados = [];
                let vehOcupados = [];

                tareasDelDia.forEach(t => {
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, t.horaInicio || null, t.horaFin || null)) return;
                    if (t.asignadoANombre) ocupados.push(t.asignadoANombre);
                    if (t.cuadrillaNombres) ocupados.push(...t.cuadrillaNombres);
                    if (t.vehiculosAsignados) vehOcupados.push(...t.vehiculosAsignados);
                });

                eventosDelDia.forEach(ev => {
                    // Extract HH:MM local time from Date
                    const horaIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                    const horaFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, horaIni, horaFin)) return;
                    
                    if (ev.participantes) ocupados.push(...ev.participantes);
                    if (ev.vehiculosAsignados) vehOcupados.push(...ev.vehiculosAsignados);
                });
                
                const allUsers = await UserRef.find().sort({ nombre: 1 });
                const allVehs = await VehicleRef.find().sort({ modelo: 1 });
                
                let userList = [];
                let uNum = 1;
                allUsers.forEach(u => {
                    const isOcupado = ocupados.some(o => o && o.toLowerCase().includes(u.nombre.toLowerCase()));
                    userList.push({ num: uNum++, nombre: u.nombre, ocupado: isOcupado, id: u._id.toString() });
                });

                let vehList = [];
                let vNum = 1;
                allVehs.forEach(v => {
                    const isOcupado = vehOcupados.includes(v._id.toString()) || v.estado === 'Prestado';
                    vehList.push({ num: vNum++, modelo: `${v.marca || ''} ${v.modelo} ${v.placas || ''}`.trim(), ocupado: isOcupado, id: v._id.toString() });
                });

                s.ctx.userList = userList;
                s.ctx.vehList = vehList;
                
                let usersTxt = userList.map(u => `${u.num}. ${u.nombre} ${u.ocupado ? '🔴 Ocupado' : '🟢 Libre'}`).join('\n');
                
                s.state = 'WAITING_TAREA_ENCARGADO';
                await setSession(effectiveFrom, s);
                await reply(`📊 *LISTA DE PERSONAL*\n\n${usersTxt}\n\n👤 ¿Quién será el *ENCARGADO*? (Escribe el número)`);
            } catch(e) {
                console.error(e);
                await reply('Error consultando recursos.');
                await setSession(From, { state: 'IDLE', ctx: {} });
            }
        } else if (s.state === 'WAITING_TAREA_ENCARGADO') {
            const num = parseInt(Body.trim());
            const user = (s.ctx.userList || []).find(u => u.num === num);
            if (!user) {
                await reply(`⚠️ Número no válido. Por favor, escribe un número de la lista:`);
                return;
            }
            if (user.ocupado) {
                await reply(`❌ Error: Has seleccionado a ${user.nombre} que está 🔴 Ocupado en ese horario.\n\nPor favor, elige el número de alguien que esté 🟢 Libre.`);
                return; // Bloqueo estricto
            }
            s.ctx.encargado = user.nombre;
            s.state = 'WAITING_TAREA_ACOMPANANTES';
            await setSession(effectiveFrom, s);
            await reply(`👥 ¿Quiénes van de *ACOMPAÑANTES*?\n(Escribe los números separados por coma, o "ninguno"/"0")`);
        } else if (s.state === 'WAITING_TAREA_ACOMPANANTES') {
            const b = Body.trim().toLowerCase();
            if (b === 'ninguno' || b === 'no' || b === '0') {
                s.ctx.acompanantes = [];
            } else {
                const nums = b.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                const users = (s.ctx.userList || []).filter(u => nums.includes(u.num));
                s.ctx.acompanantes = users.map(u => u.nombre);
                
                const ocupadosSeleccionados = users.filter(u => u.ocupado).map(u => u.nombre);
                if (ocupadosSeleccionados.length > 0) {
                    await reply(`❌ Error: Has incluido acompañantes que están 🔴 Ocupados (${ocupadosSeleccionados.join(', ')}).\n\nPor favor, responde de nuevo con números de personas que estén 🟢 Libres (o "0" para ninguno).`);
                    return; // Bloqueo estricto
                }
            }

            let vehsTxt = (s.ctx.vehList || []).map(v => `${v.num}. ${v.modelo} ${v.ocupado ? '🔴 Ocupado' : '🟢 Libre'}`).join('\n');
            s.state = 'WAITING_TAREA_VEHICULOS';
            await setSession(effectiveFrom, s);
            await reply(`🚗 *LISTA DE VEHÍCULOS*\n\n${vehsTxt}\n\n¿Qué *VEHÍCULOS* se usarán? (Escribe los números separados por coma, o "ninguno"/"0")`);
        } else if (s.state === 'WAITING_TAREA_VEHICULOS') {
            const b = Body.trim().toLowerCase();
            if (b === 'ninguno' || b === 'no' || b === '0') {
                s.ctx.vehiculosIds = [];
                s.ctx.vehiculosTxt = 'Ninguno';
            } else {
                const nums = b.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                const vehs = (s.ctx.vehList || []).filter(v => nums.includes(v.num));
                s.ctx.vehiculosIds = vehs.map(v => v.id);
                s.ctx.vehiculosTxt = vehs.map(v => v.modelo).join(', ');

                const ocupadosSeleccionados = vehs.filter(v => v.ocupado).map(v => v.modelo);
                if (ocupadosSeleccionados.length > 0) {
                    await reply(`❌ Error: Has seleccionado vehículos que están 🔴 Ocupados (${ocupadosSeleccionados.join(', ')}).\n\nPor favor, responde de nuevo con números de vehículos 🟢 Libres (o "0").`);
                    return; // Bloqueo estricto
                }
            }
            
            const proyectosActivos = await CRMProyecto.find({ estado: { $in: ['Activo', 'Pausado'] } }).sort({ fechaInicio: -1 });
            let proyList = [];
            let pNum = 1;
            proyectosActivos.forEach(p => { proyList.push({ num: pNum++, folio: p.folio, nombre: p.nombre, id: p._id.toString() }); });
            s.ctx.proyList = proyList;
            
            let proysTxt = proyList.length > 0 ? proyList.map(p => `${p.num}. [${p.folio || 'S/F'}] ${p.nombre}`).join('\n') : 'No hay proyectos activos.';

            s.state = 'WAITING_TAREA_PROYECTO';
            await setSession(effectiveFrom, s);
            await reply(`🏗️ *PROYECTOS ACTIVOS*\n\n${proysTxt}\n\n¿A qué *PROYECTO* deseas vincularlo?\n(Escribe el número, o "0"/"no" para ninguno)`);
        } else if (s.state === 'WAITING_TAREA_PROYECTO') {
            const b = Body.trim().toLowerCase();
            if (b === 'no' || b === 'ninguno' || b === '0') {
                s.ctx.proyecto = null;
                s.ctx.proyectoId = '';
            } else {
                const num = parseInt(b);
                const proy = (s.ctx.proyList || []).find(p => p.num === num);
                if (proy) {
                    s.ctx.proyecto = proy.folio ? `${proy.folio} - ${proy.nombre}` : proy.nombre;
                    s.ctx.proyectoId = proy.id;
                } else {
                    s.ctx.proyecto = Body.trim(); // Fallback si escriben nombre
                    s.ctx.proyectoId = '';
                }
            }
            
            try {
                if (s.ctx.isEvento) {
                    // Guardar como Junta/Levantamiento/Cita (CRMEvento)
                    const nEvento = new CRMEvento({
                        tipo: s.ctx.type,
                        titulo: `[WA] ${s.ctx.type} - ${s.ctx.desc}`,
                        descripcion: `Proyecto: ${s.ctx.proyecto || 'Ninguno'} | Agendado vía WhatsApp`,
                        fechaInicio: new Date(`${s.ctx.parsedFecha.toISOString().split('T')[0]}T${s.ctx.timeStr}:00`),
                        fechaFin: s.ctx.timeEndStr ? new Date(`${s.ctx.parsedFecha.toISOString().split('T')[0]}T${s.ctx.timeEndStr}:00`) : new Date(`${s.ctx.parsedFecha.toISOString().split('T')[0]}T${s.ctx.timeStr}:00`),
                        participantes: [s.ctx.encargado, ...s.ctx.acompanantes],
                        vehiculosAsignados: s.ctx.vehiculosIds || []
                    });
                    await nEvento.save();
                    await reply(`✅ *${s.ctx.type.toUpperCase()} AGENDADO EXITOSAMENTE*\n\n📋 ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n👥 Acompañantes: ${s.ctx.acompanantes.join(', ') || 'Ninguno'}\n🚗 Vehículos: ${s.ctx.vehiculosTxt}\n🏗️ Proyecto: ${s.ctx.proyecto || 'Ninguno'}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr} - ${s.ctx.timeEndStr || 'Sin hora fin'}\n\nEnviando notificaciones al personal...`);
                } else {
                    // Guardar como Tarea (CRMActividad)
                    const nTarea = new CRMActividad({
                        descripcion: s.ctx.desc,
                        asignadoANombre: s.ctx.encargado,
                        cuadrillaNombres: s.ctx.acompanantes,
                        vehiculosAsignados: s.ctx.vehiculosIds || [],
                        proyectoId: s.ctx.proyectoId || s.ctx.proyecto || '',
                        estado: 'Pendiente',
                        fechaVencimiento: s.ctx.parsedFecha,
                        horaInicio: s.ctx.timeStr,
                        horaFin: s.ctx.timeEndStr,
                        tipoDestino: s.ctx.proyecto ? 'Proyecto vinculado' : 'Asignación vía WhatsApp'
                    });
                    await nTarea.save();
                    await reply(`✅ *TAREA CREADA EXITOSAMENTE*\n\n📋 ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n👥 Acompañantes: ${s.ctx.acompanantes.join(', ') || 'Ninguno'}\n🚗 Vehículos: ${s.ctx.vehiculosTxt}\n🏗️ Proyecto: ${s.ctx.proyecto || 'Ninguno'}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr} - ${s.ctx.timeEndStr || 'Sin hora fin'}\n\nEnviando notificaciones al personal...`);
                }
                
                // NOTIFICACIONES WHATSAPP
                const allUsers = await UserRef.find();
                
                const findPhone = (name) => {
                    const u = allUsers.find(x => x.nombre && x.nombre.toLowerCase().includes(name.toLowerCase()));
                    return u && u.telefono ? u.telefono : null;
                };

                const telEncargado = findPhone(s.ctx.encargado);
                if (telEncargado) {
                    const msgEncargado = `🚨 *NUEVA TAREA ASIGNADA (Encargado)* 🚨\n\n📋 Tarea: ${s.ctx.desc}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}\n👥 Te acompañan: ${s.ctx.acompanantes.join(', ') || 'Nadie'}\n🚗 Vehículo(s): ${s.ctx.vehiculosTxt}\n🏗️ Proyecto/Cliente: ${s.ctx.proyecto || 'No vinculado'}`;
                    await sendWhatsAppMessage(telEncargado, msgEncargado);
                }
                
                for (let ac of s.ctx.acompanantes) {
                    const telAc = findPhone(ac);
                    if (telAc) {
                        const msgAc = `🔔 *NUEVA TAREA ASIGNADA (Acompañante)* 🔔\n\n📋 Tarea: ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}`;
                        await sendWhatsAppMessage(telAc, msgAc);
                    }
                }
                
            } catch (e) {
                console.error('Error guardando tarea WA:', e);
                await reply(`❌ Error al crear la tarea. Intenta de nuevo.`);
            }
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
        } else if (s.state === 'WAITING_VEHICLE_CONFIRM') {
            const b = text.trim().toLowerCase();
            if (b === '1' || b === 'aceptar' || b === 'acepto' || b === 'si' || b === 'sí') {
                try {
                    let mainApiUrl = s.ctx.mainApiUrl || 'https://entregables-production-b834.up.railway.app';
                    // Normalizar dominio viejo por si la sesión se generó antes del fix
                    mainApiUrl = mainApiUrl.replace('naisa.newbox.mx', 'entregables-production-b834.up.railway.app').replace('www.naisata.com', 'entregables-production-b834.up.railway.app');
                    // Asegurarnos de que tenga https:// si lo reemplazamos sin protocolo
                    if (!mainApiUrl.startsWith('http')) mainApiUrl = `https://${mainApiUrl}`;
                    const txId = s.ctx.txId;
                    const confirmUrl = `${mainApiUrl}/api/assignments/vehicle/${txId}/confirm`;
                    waLog.add(`🔗 Intentando confirmar: txId=${txId} url=${confirmUrl}`);
                    // Llamar al endpoint principal para confirmar
                    const confirmRes = await fetch(confirmUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ firma: 'whatsapp-confirmation' })
                    });
                    if (confirmRes.ok) {
                        await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
                        return reply(`✅ *VEHÍCULO ACEPTADO*\n\n¡Perfecto! La asignación quedó confirmada. Ya puedes disponer del vehículo.\n\n🚗 ¡Buen viaje y maneja con precaución!`);
                    } else {
                        const errData = await confirmRes.json().catch(() => ({}));
                        waLog.add(`⚠️ Confirm HTTP ${confirmRes.status}: ${JSON.stringify(errData).substring(0,80)}`);
                        await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
                        return reply(`⚠️ No se pudo confirmar: ${errData.error || 'La asignación ya no es válida'}. Se ha cancelado el proceso actual.`);
                    }
                } catch(e) {
                    const cause = e.cause ? ` | causa: ${e.cause.message || e.cause}` : '';
                    waLog.addError(`Confirmando vehiculo via WA (txId=${s.ctx.txId} url=${s.ctx.mainApiUrl})`, new Error(e.message + cause));
                    await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
                    return reply(`❌ Error de conexión al confirmar. Intenta desde la app o contacta al administrador.`);
                }
            } else if (b === '2' || b === 'rechazar' || b === 'rechazo' || b === 'no') {
                try {
                    let mainApiUrl = s.ctx.mainApiUrl || 'https://entregables-production-b834.up.railway.app';
                    // Normalizar dominio viejo por si la sesión se generó antes del fix
                    mainApiUrl = mainApiUrl.replace('naisa.newbox.mx', 'entregables-production-b834.up.railway.app').replace('www.naisata.com', 'entregables-production-b834.up.railway.app');
                    if (!mainApiUrl.startsWith('http')) mainApiUrl = `https://${mainApiUrl}`;
                    const txId = s.ctx.txId;
                    const rejectUrl = `${mainApiUrl}/api/assignments/vehicle/${txId}/reject`;
                    waLog.add(`🔗 Intentando rechazar: txId=${txId} url=${rejectUrl}`);
                    const rejectRes = await fetch(rejectUrl, { method: 'PUT' });
                    if (!rejectRes.ok) {
                        waLog.add(`⚠️ Reject HTTP ${rejectRes.status}`);
                    }
                } catch(e) {
                    const cause = e.cause ? ` | causa: ${e.cause.message || e.cause}` : '';
                    waLog.addError(`Rechazando vehiculo via WA (txId=${s.ctx.txId} url=${s.ctx.mainApiUrl})`, new Error(e.message + cause));
                }
                await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
                return reply(`❌ *ASIGNACIÓN RECHAZADA*\n\nHas rechazado la asignación del vehículo. El administrador ha sido notificado.`);
            } else {
                return reply(`⚠️ Respuesta no reconocida.\n\nEscribe *ACEPTAR* para confirmar la recepción o *RECHAZAR* para declinar. Si deseas salir de esto, escribe *CANCELAR*.`);
            }
        }

    } catch (err) {
        console.error('Error procesando mensaje de WhatsApp:', err);
    }
};

    waClient.on('message', waMessageHandler);
    waClient.initialize();
};

if (mongoose.connection.readyState === 1) {
    initWhatsApp();
} else {
    mongoose.connection.once('open', initWhatsApp);
}

// --- WATCHDOG: Reiniciar bot si lleva mucho tiempo desconectado ---
// Si a los 3 minutos de arrancar el servidor el bot sigue DESCONECTADO
// (sin haber llegado a ESPERANDO_ESCANEO ni CONECTADO), lo reinicia solo.
let waInitTimestamp = Date.now();
setInterval(async () => {
    if (waStatus === 'CONECTADO' || waStatus === 'ESPERANDO_ESCANEO') {
        waInitTimestamp = Date.now();
        return;
    }
    const minutosSinConectar = (Date.now() - waInitTimestamp) / 60000;
    if (minutosSinConectar >= 3) {
        waLog.add(`🐕 Watchdog: ${Math.floor(minutosSinConectar)}min en "${waStatus}". Forzando reinicio...`);
        waInitTimestamp = Date.now();
        // Forzar reset del flag para romper el deadlock si Puppeteer se colgó
        waInitializing = false;
        try {
            if (waClient) {
                try { await waClient.destroy(); } catch(_) {}
                waClient = null;
            }
        } catch(_) {}
        setTimeout(() => initWhatsApp(), 3000);
    }
}, 60000);
// -------------------------------------------------------

// Favicon (evitar 404 en el log)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Recordatorios automáticos de eventos ---
setInterval(async () => {
    try {
        if (!waReady || waStatus !== 'CONECTADO') return;
        
        const ahora = new Date();
        const enHoraYMedia = new Date(ahora.getTime() + 90 * 60 * 1000);
        
        // Buscar eventos (SOLO Juntas y Levantamientos) que comiencen en los próximos 90 minutos
        const eventos = await CRMEvento.find({
            tipo: { $in: ['Junta', 'Levantamiento'] },
            fechaInicio: { $gt: ahora, $lte: enHoraYMedia },
            recordatorioEnviado: { $ne: true }
        });
        
        if (eventos.length === 0) return;
        
        const allUsers = await UserRef.find();
        const findPhone = (name) => {
            const queryName = name.trim().toLowerCase().replace(/\s+/g, ' ');
            const u = allUsers.find(x => {
                const soloNombre = (x.nombre || '').trim().toLowerCase();
                const soloApellido = (x.apellido || '').trim().toLowerCase();
                const fullName = `${soloNombre} ${soloApellido}`.trim().replace(/\s+/g, ' ');
                if (!fullName) return false;
                return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
            });
            return u && u.telefono ? u.telefono : null;
        };

        for (const ev of eventos) {
            const timeStr = ev.fechaInicio.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
            
            for (const participante of (ev.participantes || [])) {
                const tel = findPhone(participante);
                if (tel) {
                    const msg = `⏰ *RECORDATORIO DE ${ev.tipo.toUpperCase()}*\n\nHola ${participante}, te recordamos que tienes programado: *${ev.titulo}*.\n\n🕒 Inicia a las: ${timeStr}\n📝 Detalles: ${ev.descripcion}\n\nPor favor, prepárate con anticipación.`;
                    await sendWhatsAppMessage(tel, msg).catch(e => console.error("Error enviando recordatorio WA:", e));
                }
            }
            
            ev.recordatorioEnviado = true;
            await ev.save();
        }
    } catch(err) {
        console.error('Error en loop de recordatorios:', err);
    }
}, 60000); // Revisar cada minuto

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    // console.log(`🚀 Servidor CRM corriendo en el puerto ${PORT}`);
});
