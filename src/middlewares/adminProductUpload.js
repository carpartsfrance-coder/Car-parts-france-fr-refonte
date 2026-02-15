const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'products');

fs.mkdirSync(uploadDir, { recursive: true });

function safeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.png') return '.png';
  if (ext === '.jpg') return '.jpg';
  if (ext === '.jpeg') return '.jpeg';
  if (ext === '.webp') return '.webp';
  return '.png';
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = safeExt(file.originalname);
    const rand = Math.random().toString(16).slice(2, 10);
    cb(null, `product-${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    if (!file || !file.mimetype) return cb(null, false);
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error("Fichier non supporté. Merci d'envoyer une image (PNG, JPG, WEBP)."));
    }
    return cb(null, true);
  },
});

function handleProductImageUpload(req, res, next) {
  const multi = upload.array('image', 10);

  multi(req, res, (err) => {
    if (err) {
      req.uploadError = err.message || "Erreur lors de l'upload.";
      return next();
    }

    if (Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
    }

    return next();
  });
}

module.exports = {
  handleProductImageUpload,
};
