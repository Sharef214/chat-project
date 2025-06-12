require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');


// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  
  // Serve static files from React build
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  // Catch all handler: send back React's index.html file for non-API routes
  app.get('*', (req, res) => {
    // Don't serve React for API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}

// Import database models and helpers
const {
  Worker,
  Message,
  ChatRoom,
  Callback,
  ChatRating,
  CustomerSession,
  Settings,
  initializeDatabase,
  WorkerHelpers,
  MessageHelpers,
  ChatRoomHelpers
} = require('./models');

// Import Cloudinary configuration
const {
  storage,
  voiceStorage,
  fileFilter,
  voiceFilter,
  deleteFromCloudinary,
  getPublicIdFromUrl
} = require('./config/cloudinary');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 120000,
  pingInterval: 60000,
  maxHttpBufferSize: 1e6,
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer with Cloudinary storage for regular files
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter
});

// Configure multer for voice notes with Cloudinary
const uploadVoice = multer({
  storage: voiceStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for voice notes
  },
  fileFilter: voiceFilter
});

// In-memory storage for active sessions
let workerSockets = new Map(); // workerId -> socketId
let activeCustomers = new Map(); // customerId -> customerData

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharef-chat')
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    await initializeDatabase();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  });

// Helper function to find available worker
async function findAvailableWorker() {
  const availableWorkers = await WorkerHelpers.findAvailable();
  return availableWorkers.length > 0 ? availableWorkers[0] : null;
}

// Helper function to find worker socket
function findWorkerSocket(workerId) {
  return workerSockets.get(workerId.toString());
}

// Helper function to assign customer to worker
async function assignCustomerToWorker(customerId, worker) {
  const roomId = `room_${customerId}_${worker._id}`;
  
  try {
    // Update worker status to busy
    await WorkerHelpers.updateStatus(worker._id, 'busy', customerId);
    
    // Create chat room in database
    await ChatRoomHelpers.create(roomId, customerId, worker);
    
    // Store customer session
    const customerSession = new CustomerSession({
      customerId,
      roomId,
      workerId: worker._id,
      workerName: worker.username
    });
    await customerSession.save();
    
    console.log(`🤝 Customer ${customerId} assigned to ${worker.username}`);
    
    return {
      roomId,
      workerId: worker._id,
      workerName: worker.username
    };
  } catch (error) {
    console.error('Error assigning customer to worker:', error);
    throw error;
  }
}

// Routes
app.post('/api/worker/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const worker = await Worker.findOne({ username });
    if (!worker) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await worker.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last active
    await worker.updateLastActive();
    
    const token = jwt.sign({ workerId: worker._id, username }, JWT_SECRET);
    res.json({ 
      token, 
      worker: { 
        id: worker._id, 
        username: worker.username,
        status: worker.status 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/customer/join', async (req, res) => {
  const customerId = 'customer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  try {
    // Find available worker
    const availableWorker = await findAvailableWorker();
    
    console.log('🔍 Customer trying to join...');
    console.log('✅ Available worker found:', availableWorker ? availableWorker.username : 'None');
    
    if (availableWorker) {
      const assignmentResult = await assignCustomerToWorker(customerId, availableWorker);
      
      activeCustomers.set(customerId, {
        id: customerId,
        roomId: assignmentResult.roomId,
        workerId: assignmentResult.workerId,
        workerName: assignmentResult.workerName,
        joinedAt: new Date()
      });
      
      res.json({
        customerId,
        roomId: assignmentResult.roomId,
        workerId: assignmentResult.workerId,
        workerName: assignmentResult.workerName,
        status: 'connected'
      });
    } else {
      console.log('🚫 All workers busy - sending callback option');
      res.json({
        customerId,
        status: 'busy',
        message: 'All our agents are currently busy. Please leave your contact info for a callback.'
      });
    }
  } catch (error) {
    console.error('Error in customer join:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/callback', async (req, res) => {
  const { name, phone, email, message } = req.body;
  
  try {
    const callbackRequest = new Callback({
      name,
      phone,
      email,
      message
    });
    
    await callbackRequest.save();
    
    // Notify all workers about new callback request
    io.emit('new-callback', {
      id: callbackRequest._id,
      name: callbackRequest.name,
      phone: callbackRequest.phone,
      email: callbackRequest.email,
      message: callbackRequest.message,
      requestedAt: callbackRequest.requestedAt,
      status: callbackRequest.status
    });
    
    res.json({ success: true, message: 'Callback request submitted successfully' });
  } catch (error) {
    console.error('Error creating callback:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/worker/callbacks', async (req, res) => {
  try {
    const callbacks = await Callback.find({ status: 'pending' })
      .sort({ requestedAt: -1 })
      .limit(50);
    res.json(callbacks);
  } catch (error) {
    console.error('Error fetching callbacks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a route to check worker status for debugging
app.get('/api/workers/status', async (req, res) => {
  try {
    const workers = await Worker.find({}, 'username status currentCustomer lastActive')
      .sort({ username: 1 });
    
    res.json({
      workers: workers.map(w => ({
        id: w._id,
        username: w.username,
        status: w.status,
        currentCustomer: w.currentCustomer,
        lastActive: w.lastActive
      }))
    });
  } catch (error) {
    console.error('Error fetching worker status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// File upload endpoint with Cloudinary
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.bytes || req.file.size,
      url: req.file.secure_url || req.file.path, // Cloudinary secure URL
      public_id: req.file.public_id,
      secure_url: req.file.secure_url || req.file.path,
      format: req.file.format,
      resource_type: req.file.resource_type,
      created_at: req.file.created_at
    };

    console.log('📎 File uploaded to Cloudinary:', fileInfo.originalname);
    console.log('🔗 Cloudinary URL:', fileInfo.secure_url);
    
    res.json(fileInfo);
  } catch (error) {
    console.error('Error uploading file to Cloudinary:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Voice note upload endpoint with Cloudinary
app.post('/api/upload-voice', uploadVoice.single('voice'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No voice file uploaded' });
    }

    const voiceInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.bytes || req.file.size,
      url: req.file.secure_url || req.file.path, // Cloudinary secure URL
      public_id: req.file.public_id,
      secure_url: req.file.secure_url || req.file.path,
      duration: req.body.duration || 0,
      format: req.file.format,
      resource_type: req.file.resource_type,
      created_at: req.file.created_at
    };

    console.log('🎤 Voice note uploaded to Cloudinary:', voiceInfo.filename);
    console.log('🔗 Cloudinary URL:', voiceInfo.secure_url);
    
    res.json(voiceInfo);
  } catch (error) {
    console.error('Error uploading voice note to Cloudinary:', error);
    res.status(500).json({ error: 'Voice upload failed' });
  }
});

// Delete file from Cloudinary endpoint
app.delete('/api/files/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    const { resource_type = 'image' } = req.query;
    
    const result = await deleteFromCloudinary(publicId, resource_type);
    
    if (result.result === 'ok') {
      res.json({ success: true, message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Chat rating endpoint
app.post('/api/chat/rate', async (req, res) => {
  try {
    const { roomId, customerId, workerId, rating, feedback, workerName } = req.body;
    
    if (!roomId || !customerId || !workerId || !rating) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const chatRating = new ChatRating({
      roomId,
      customerId,
      workerId,
      workerName,
      rating,
      feedback: feedback || ''
    });
    
    await chatRating.save();
    
    console.log(`⭐ Chat rated: ${rating}/5 stars for worker ${workerName} (${workerId})`);
    
    // Notify worker about the rating
    io.to(`worker_${workerId}`).emit('chat-rated', {
      rating,
      feedback,
      timestamp: chatRating.timestamp
    });
    
    res.json({ success: true, message: 'Rating submitted successfully' });
  } catch (error) {
    console.error('Error saving rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// Get ratings statistics for workers
app.get('/api/ratings/stats', async (req, res) => {
  try {
    const totalRatings = await ChatRating.countDocuments();
    const ratings = await ChatRating.find({});
    
    let stats = {
      totalRatings,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      workerStats: {},
      recentRatings: []
    };
    
    if (totalRatings > 0) {
      // Calculate overall average
      const totalRating = ratings.reduce((sum, rating) => sum + rating.rating, 0);
      stats.averageRating = (totalRating / totalRatings).toFixed(1);
      
      // Calculate rating distribution
      ratings.forEach(rating => {
        stats.ratingDistribution[rating.rating]++;
      });
      
      // Calculate per-worker stats
      const workerRatings = {};
      ratings.forEach(rating => {
        const workerId = rating.workerId.toString();
        if (!workerRatings[workerId]) {
          workerRatings[workerId] = {
            workerName: rating.workerName,
            ratings: [],
            totalRatings: 0,
            averageRating: 0
          };
        }
        workerRatings[workerId].ratings.push(rating.rating);
        workerRatings[workerId].totalRatings++;
      });
      
      // Calculate averages for each worker
      Object.keys(workerRatings).forEach(workerId => {
        const worker = workerRatings[workerId];
        const sum = worker.ratings.reduce((acc, rating) => acc + rating, 0);
        worker.averageRating = (sum / worker.totalRatings).toFixed(1);
        stats.workerStats[workerId] = worker;
      });
      
      // Get recent ratings
      const recentRatings = await ChatRating.find({})
        .sort({ timestamp: -1 })
        .limit(10)
        .lean();
      stats.recentRatings = recentRatings;
    }
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting rating stats:', error);
    res.status(500).json({ error: 'Failed to get rating statistics' });
  }
});

// Get recent feedback with details
app.get('/api/ratings/feedback', async (req, res) => {
  try {
    const feedbackList = await ChatRating.find({
      feedback: { $exists: true, $ne: '', $regex: /.+/ }
    })
      .sort({ timestamp: -1 })
      .limit(20)
      .select('rating feedback workerName timestamp')
      .lean();
    
    res.json(feedbackList.map(rating => ({
      id: rating._id,
      rating: rating.rating,
      feedback: rating.feedback,
      workerName: rating.workerName,
      timestamp: rating.timestamp,
      date: new Date(rating.timestamp).toDateString()
    })));
  } catch (error) {
    console.error('Error getting feedback:', error);
    res.status(500).json({ error: 'Failed to get feedback' });
  }
});

// Worker Management Routes (Admin)

// Get all workers (for admin interface)
app.get('/api/admin/workers', async (req, res) => {
  try {
    const workers = await Worker.find({}, '-password')
      .sort({ createdAt: 1 });
    
    res.json({
      workers: workers.map(w => ({
        id: w._id,
        username: w.username,
        status: w.status,
        currentCustomer: w.currentCustomer,
        createdAt: w.createdAt,
        lastActive: w.lastActive
      }))
    });
  } catch (error) {
    console.error('Error fetching workers:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register new worker
app.post('/api/admin/workers/register', async (req, res) => {
  const { username, password, adminKey } = req.body;
  
  // Simple admin protection
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Validate input
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    // Check if username already exists
    const existingWorker = await Worker.findOne({ username });
    if (existingWorker) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    // Create new worker
    const newWorker = new Worker({
      username,
      password // Will be hashed by the pre-save middleware
    });
    
    await newWorker.save();
    
    console.log(`✅ New worker registered: ${username} (ID: ${newWorker._id})`);
    
    res.json({ 
      success: true, 
      message: 'Worker registered successfully',
      worker: {
        id: newWorker._id,
        username: newWorker.username,
        status: newWorker.status,
        createdAt: newWorker.createdAt
      }
    });
  } catch (error) {
    console.error('Error registering worker:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete worker
app.delete('/api/admin/workers/:id', async (req, res) => {
  const { adminKey } = req.body;
  const workerId = req.params.id;
  
  // Simple admin protection
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    // Find worker
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    // Check if worker is currently in a chat
    if (worker.currentCustomer) {
      return res.status(400).json({ 
        error: 'Cannot delete worker who is currently in a chat' 
      });
    }
    
    // Remove worker
    await Worker.findByIdAndDelete(workerId);
    
    // Remove from socket mapping if connected
    workerSockets.delete(workerId);
    
    console.log(`🗑️ Worker deleted: ${worker.username} (ID: ${workerId})`);
    
    res.json({ 
      success: true, 
      message: 'Worker deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting worker:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update worker password
app.put('/api/admin/workers/:id/password', async (req, res) => {
  const { newPassword, adminKey } = req.body;
  const workerId = req.params.id;
  
  // Simple admin protection
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    // Find worker
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    // Update password (will be hashed by pre-save middleware)
    worker.password = newPassword;
    await worker.save();
    
    console.log(`🔑 Password updated for worker: ${worker.username}`);
    
    res.json({ 
      success: true, 
      message: 'Password updated successfully' 
    });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [workerStats, activeChats, pendingCallbacks, totalRatings, avgRating] = await Promise.all([
      WorkerHelpers.getStats(),
      ChatRoom.countDocuments({ status: 'active' }),
      Callback.countDocuments({ status: 'pending' }),
      ChatRating.countDocuments(),
      ChatRating.aggregate([
        { $group: { _id: null, avgRating: { $avg: '$rating' } } }
      ])
    ]);
    
    const stats = {
      totalWorkers: workerStats.total,
      availableWorkers: workerStats.available,
      busyWorkers: workerStats.busy,
      offlineWorkers: workerStats.offline,
      activeChats,
      pendingCallbacks,
      totalRatings,
      averageRating: avgRating.length > 0 ? avgRating[0].avgRating.toFixed(1) : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting admin stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 New connection:', socket.id);
  
  // Handle connection errors
  socket.on('error', (error) => {
    console.log('❌ Socket error:', error);
  });

  // Worker joins their workspace
  socket.on('worker-join', async (data) => {
    const { workerId } = data;
    socket.join(`worker_${workerId}`);
    socket.workerId = workerId;
    
    // Store worker socket ID for later reference
    workerSockets.set(workerId, socket.id);
    
    try {
      // Update worker status to available when they join
      await WorkerHelpers.updateStatus(workerId, 'available');
      console.log(`✅ Worker ${workerId} is now AVAILABLE`);
      
      // Send current status
      const worker = await Worker.findById(workerId);
      io.to(`worker_${workerId}`).emit('worker-status', {
        status: worker ? worker.status : 'offline',
        currentCustomer: worker ? worker.currentCustomer : null,
        queueLength: activeCustomers.size
      });
    } catch (error) {
      console.error(`❌ Error updating worker ${workerId} status:`, error);
    }
  });
  
  // Customer joins chat room
  socket.on('customer-join', (data) => {
    const { customerId, roomId } = data;
    socket.join(roomId);
    socket.customerId = customerId;
    socket.roomId = roomId;
    
    console.log(`👤 Customer ${customerId} joined room ${roomId}`);
    
    // Notify worker that customer joined AND make worker join the room
    const customer = activeCustomers.get(customerId);
    if (customer) {
      // Find the worker's socket and make them join the chat room
      const workerSocketId = findWorkerSocket(customer.workerId);
      if (workerSocketId) {
        const workerSocket = io.sockets.sockets.get(workerSocketId);
        if (workerSocket) {
          workerSocket.join(roomId);
          console.log(`👨‍💼 Worker ${customer.workerId} also joined room ${roomId}`);
        }
      }
      
      io.to(`worker_${customer.workerId}`).emit('customer-connected', {
        customerId,
        roomId
      });
      console.log(`📣 Notified worker ${customer.workerId} about customer ${customerId}`);
    }
  });
  
  // Handle messages
  socket.on('send-message', async (data) => {
    const { roomId, message, sender, senderId, messageType, fileData } = data;
    
    const messageData = {
      id: Date.now(),
      roomId,
      message,
      sender, // 'customer' or 'worker'
      senderId,
      messageType: messageType || 'text', // 'text', 'image', 'file', 'voice'
      fileData: fileData || null, // file information if applicable
      status: 'sent', // 'sent', 'delivered', 'read'
      timestamp: new Date()
    };
    
    try {
      // Save message to database
      await MessageHelpers.saveMessage(messageData);
      
      console.log(`💬 ${messageType || 'text'} message in room ${roomId} from ${sender}:`, 
                  messageType === 'text' ? message : `${messageType} file`);
      
      // Broadcast message to room
      io.to(roomId).emit('new-message', messageData);
      
      // Send delivery confirmation back to sender
      setTimeout(() => {
        messageData.status = 'delivered';
        io.to(roomId).emit('message-status-update', {
          messageId: messageData.id,
          status: 'delivered'
        });
      }, 100);
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('message-error', { error: 'Failed to save message' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing-start', (data) => {
    const { roomId, sender } = data;
    
    if (!roomId || !sender) {
      console.log('❌ Invalid typing-start data:', data);
      return;
    }
    
    console.log(`⌨️ ${sender} started typing in ${roomId}`);
    socket.to(roomId).emit('user-typing', { sender, typing: true });
  });
  
  socket.on('typing-stop', (data) => {
    const { roomId, sender } = data;
    
    if (!roomId || !sender) {
      console.log('❌ Invalid typing-stop data:', data);
      return;
    }
    
    console.log(`⌨️ ${sender} stopped typing in ${roomId}`);
    socket.to(roomId).emit('user-typing', { sender, typing: false });
  });
  
  // Handle message read status
  socket.on('message-read', async (data) => {
    const { roomId, messageId } = data;
    
    if (!roomId || !messageId) {
      console.log('❌ Invalid message-read data:', data);
      return;
    }
    
    console.log(`👁️ Message ${messageId} read in ${roomId}`);
    
    try {
      // Update message status in database
      await MessageHelpers.updateStatus(messageId, 'read');
      
      // Broadcast read status to room
      io.to(roomId).emit('message-status-update', {
        messageId,
        status: 'read'
      });
    } catch (error) {
      console.error('Error updating message read status:', error);
    }
  });
  
  // Handle bulk message read (when chat becomes visible)
  socket.on('messages-read', async (data) => {
    const { roomId, messageIds } = data;
    console.log(`👁️ Multiple messages read in ${roomId}:`, messageIds.length);
    
    try {
      // Update message statuses in database
      await Message.updateMany(
        { messageId: { $in: messageIds } },
        { status: 'read' }
      );
      
      // Broadcast read statuses to room
      messageIds.forEach(messageId => {
        io.to(roomId).emit('message-status-update', {
          messageId,
          status: 'read'
        });
      });
    } catch (error) {
      console.error('Error updating bulk message read status:', error);
    }
  });
  
  // Worker ends chat
  socket.on('end-chat', async (data) => {
    const { roomId, workerId } = data;
    
    console.log(`🔚 Worker ${workerId} ended chat in room ${roomId}`);
    
    try {
      // Update worker status
      await WorkerHelpers.updateStatus(workerId, 'available', null);
      
      // End chat room in database
      await ChatRoomHelpers.end(roomId);
      
      // Remove customer session
      const customer = Array.from(activeCustomers.values()).find(c => c.roomId === roomId);
      if (customer) {
        activeCustomers.delete(customer.id);
      }
      
      // Notify customer
      io.to(roomId).emit('chat-ended', {
        message: 'Chat session has been ended by the agent. Thank you!'
      });
    } catch (error) {
      console.error('Error ending chat:', error);
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', async (reason) => {
    console.log('👋 User disconnected:', socket.id, 'Reason:', reason);
    
    if (socket.workerId) {
      try {
        await WorkerHelpers.updateStatus(socket.workerId, 'offline', null);
        // Remove worker socket mapping
        workerSockets.delete(socket.workerId);
        console.log(`👨‍💼 Worker ${socket.workerId} went offline`);
      } catch (error) {
        console.error('Error updating worker status on disconnect:', error);
      }
    }
    
    if (socket.customerId && socket.roomId) {
      // Handle customer disconnect
      const customer = activeCustomers.get(socket.customerId);
      if (customer) {
        console.log(`👤 Customer ${socket.customerId} disconnected`);
        
        try {
          // Notify worker
          io.to(`worker_${customer.workerId}`).emit('customer-disconnected', {
            customerId: socket.customerId
          });
          
          // Free up worker
          await WorkerHelpers.updateStatus(customer.workerId, 'available', null);
          
          // End chat room
          await ChatRoomHelpers.end(socket.roomId);
          
          activeCustomers.delete(socket.customerId);
        } catch (error) {
          console.error('Error handling customer disconnect:', error);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Customer chat: http://localhost:${PORT}`);
  console.log(`👨‍💼 Worker login: http://localhost:3000?view=worker`);
  console.log(`⚙️ Admin dashboard: http://localhost:3000?view=admin`);
  console.log(`🔐 Demo login: worker1 / password123`);
  console.log(`🔑 Admin key: ${ADMIN_KEY}`);
  console.log(`☁️ File storage: Cloudinary`);
});