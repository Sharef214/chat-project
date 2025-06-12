const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Worker Schema
const workerSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  status: {
    type: String,
    enum: ['offline', 'available', 'busy'],
    default: 'offline'
  },
  currentCustomer: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
workerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
workerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update last active
workerSchema.methods.updateLastActive = function() {
  this.lastActive = new Date();
  return this.save();
};

// Message Schema
const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  roomId: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    enum: ['customer', 'worker', 'system'],
    required: true
  },
  senderId: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'voice'],
    default: 'text'
  },
  fileData: {
    filename: String,
    originalname: String,
    mimetype: String,
    size: Number,
    url: String,
    duration: Number
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
messageSchema.index({ roomId: 1, timestamp: 1 });

// Chat Room Schema
const chatRoomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  customerId: {
    type: String,
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  workerName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'ended', 'abandoned'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date,
    default: null
  },
  messageCount: {
    type: Number,
    default: 0
  }
});

// Callback Request Schema
const callbackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
  email: {
    type: String,
    trim: true,
    maxlength: 100
  },
  message: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  assignedWorker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  contactedAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    maxlength: 500
  }
});

// Chat Rating Schema
const chatRatingSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true
  },
  customerId: {
    type: String,
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  workerName: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  feedback: {
    type: String,
    maxlength: 500,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  date: {
    type: String,
    default: function() {
      return new Date().toDateString();
    }
  }
});

// Index for efficient queries
chatRatingSchema.index({ workerId: 1, timestamp: -1 });
chatRatingSchema.index({ rating: 1, timestamp: -1 });

// Customer Session Schema (for temporary session data)
const customerSessionSchema = new mongoose.Schema({
  customerId: {
    type: String,
    required: true,
    unique: true
  },
  roomId: {
    type: String,
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  workerName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'ended'],
    default: 'connected'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
});

// Auto-delete customer sessions after 24 hours of inactivity
customerSessionSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 86400 });

// System Settings Schema (for configuration)
const settingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    maxlength: 200
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create Models
const Worker = mongoose.model('Worker', workerSchema);
const Message = mongoose.model('Message', messageSchema);
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
const Callback = mongoose.model('Callback', callbackSchema);
const ChatRating = mongoose.model('ChatRating', chatRatingSchema);
const CustomerSession = mongoose.model('CustomerSession', customerSessionSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// Database initialization function
const initializeDatabase = async () => {
  try {
    console.log('🗄️ Initializing database...');
    
    // Check if we have any workers, if not create default ones
    const workerCount = await Worker.countDocuments();
    if (workerCount === 0) {
      console.log('📝 Creating default workers...');
      
      const defaultWorkers = [
        { username: 'worker1', password: 'password123' },
        { username: 'worker2', password: 'password123' },
        { username: 'alice', password: 'password123' },
        { username: 'bob', password: 'password123' },
        { username: 'sarah', password: 'password123' }
      ];
      
      for (const workerData of defaultWorkers) {
        const worker = new Worker(workerData);
        await worker.save();
        console.log(`✅ Created worker: ${workerData.username}`);
      }
    }
    
    // Initialize default settings if they don't exist
    const settingsCount = await Settings.countDocuments();
    if (settingsCount === 0) {
      console.log('⚙️ Creating default settings...');
      
      const defaultSettings = [
        {
          key: 'maxConcurrentChats',
          value: 1,
          description: 'Maximum concurrent chats per worker'
        },
        {
          key: 'chatTimeout',
          value: 1800000, // 30 minutes in milliseconds
          description: 'Chat timeout in milliseconds'
        },
        {
          key: 'enableNotifications',
          value: true,
          description: 'Enable system notifications'
        }
      ];
      
      for (const setting of defaultSettings) {
        await Settings.create(setting);
        console.log(`⚙️ Created setting: ${setting.key}`);
      }
    }
    
    console.log('✅ Database initialization complete!');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

// Helper functions for common operations
const WorkerHelpers = {
  // Find available workers
  findAvailable: async () => {
    return await Worker.find({ status: 'available' }).limit(10);
  },
  
  // Update worker status
  updateStatus: async (workerId, status, currentCustomer = null) => {
    const updateData = { status, lastActive: new Date() };
    if (currentCustomer !== undefined) {
      updateData.currentCustomer = currentCustomer;
    }
    return await Worker.findByIdAndUpdate(workerId, updateData, { new: true });
  },
  
  // Get worker stats
  getStats: async () => {
    const [total, available, busy, offline] = await Promise.all([
      Worker.countDocuments(),
      Worker.countDocuments({ status: 'available' }),
      Worker.countDocuments({ status: 'busy' }),
      Worker.countDocuments({ status: 'offline' })
    ]);
    
    return { total, available, busy, offline };
  }
};

const MessageHelpers = {
  // Save a new message
  saveMessage: async (messageData) => {
    const message = new Message({
      messageId: messageData.id,
      roomId: messageData.roomId,
      message: messageData.message,
      sender: messageData.sender,
      senderId: messageData.senderId,
      messageType: messageData.messageType || 'text',
      fileData: messageData.fileData || null,
      status: messageData.status || 'sent',
      timestamp: messageData.timestamp || new Date()
    });
    
    return await message.save();
  },
  
  // Get chat history
  getChatHistory: async (roomId, limit = 50) => {
    return await Message.find({ roomId })
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();
  },
  
  // Update message status
  updateStatus: async (messageId, status) => {
    return await Message.findOneAndUpdate(
      { messageId },
      { status },
      { new: true }
    );
  }
};

const ChatRoomHelpers = {
  // Create a new chat room
  create: async (roomId, customerId, worker) => {
    const chatRoom = new ChatRoom({
      roomId,
      customerId,
      workerId: worker._id,
      workerName: worker.username
    });
    
    return await chatRoom.save();
  },
  
  // End a chat room
  end: async (roomId) => {
    return await ChatRoom.findOneAndUpdate(
      { roomId },
      { status: 'ended', endedAt: new Date() },
      { new: true }
    );
  },
  
  // Get active chat rooms
  getActive: async () => {
    return await ChatRoom.find({ status: 'active' })
      .populate('workerId', 'username')
      .lean();
  }
};

module.exports = {
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
};