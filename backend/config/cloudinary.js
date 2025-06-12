const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for regular files
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sharef-chat/files',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'txt'],
    resource_type: 'auto', // Automatically detect resource type
    public_id: (req, file) => {
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.round(Math.random() * 1E9);
      const extension = file.originalname.split('.').pop();
      return `${timestamp}-${random}`;
    },
    transformation: [
      {
        // Optimize images
        quality: 'auto:good',
        fetch_format: 'auto'
      }
    ]
  },
});

// Configure Cloudinary storage for voice notes
const voiceStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sharef-chat/voice',
    allowed_formats: ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'aac'],
    resource_type: 'video', // Use video resource type for audio files
    public_id: (req, file) => {
      const timestamp = Date.now();
      const random = Math.round(Math.random() * 1E9);
      return `voice-${timestamp}-${random}`;
    }
  },
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Define allowed file types
  const allowedImages = /jpeg|jpg|png|gif|webp/;
  const allowedDocs = /pdf|doc|docx|txt/;
  const allowedAudio = /mp3|wav|ogg|m4a|webm|aac/;
  
  const extname = file.originalname.toLowerCase();
  const mimetype = file.mimetype.toLowerCase();
  
  const isImage = allowedImages.test(extname) || mimetype.startsWith('image/');
  const isDoc = allowedDocs.test(extname) || mimetype.includes('document') || mimetype.includes('text');
  const isAudio = allowedAudio.test(extname) || mimetype.startsWith('audio/');
  
  if (isImage || isDoc || isAudio) {
    return cb(null, true);
  } else {
    cb(new Error('Only images, documents, and audio files are allowed!'));
  }
};

// Voice file filter
const voiceFilter = (req, file, cb) => {
  const allowedAudio = /mp3|wav|ogg|m4a|webm|aac/;
  const extname = allowedAudio.test(file.originalname.toLowerCase());
  const mimetype = file.mimetype.startsWith('audio/');
  
  if (mimetype || extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only audio files are allowed for voice notes!'));
  }
};

// Helper function to delete file from Cloudinary
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    console.log('🗑️ File deleted from Cloudinary:', publicId);
    return result;
  } catch (error) {
    console.error('❌ Error deleting file from Cloudinary:', error);
    throw error;
  }
};

// Helper function to get file info from Cloudinary URL
const getPublicIdFromUrl = (url) => {
  try {
    // Extract public_id from Cloudinary URL
    // URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{folder}/{public_id}.{format}
    const parts = url.split('/');
    const fileWithExt = parts[parts.length - 1];
    const publicId = fileWithExt.split('.')[0];
    
    // Include folder path if present
    const folderIndex = parts.indexOf('upload') + 1;
    if (folderIndex < parts.length - 1) {
      const folders = parts.slice(folderIndex, -1);
      return [...folders, publicId].join('/');
    }
    
    return publicId;
  } catch (error) {
    console.error('Error extracting public ID from URL:', error);
    return null;
  }
};

// Helper function to get optimized image URL
const getOptimizedImageUrl = (publicId, options = {}) => {
  const defaultOptions = {
    quality: 'auto:good',
    fetch_format: 'auto',
    width: options.width || 'auto',
    height: options.height || 'auto',
    crop: options.crop || 'limit'
  };
  
  return cloudinary.url(publicId, defaultOptions);
};

module.exports = {
  cloudinary,
  storage,
  voiceStorage,
  fileFilter,
  voiceFilter,
  deleteFromCloudinary,
  getPublicIdFromUrl,
  getOptimizedImageUrl
};