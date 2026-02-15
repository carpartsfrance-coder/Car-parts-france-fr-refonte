const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'blog');

fs.mkdirSync(uploadDir, { recursive: true });

function safeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.png') return '.png';
  if (ext === '.jpg') return '.jpg';
  if (ext === '.jpeg') return '.jpeg';
  if (ext === '.webp') return '.webp';
  if (ext === '.gif') return '.gif';
  return '.png';
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = safeExt(file.originalname);
    const rand = Math.random().toString(16).slice(2, 10);
    cb(null, `blog-${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    if (!file || !file.mimetype) return cb(null, false);
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error("Fichier non supporté. Merci d'envoyer une image (PNG, JPG, WEBP, GIF)."));
    }
    return cb(null, true);
  },
});

function handleBlogCoverUpload(req, res, next) {
  const single = upload.single('coverImage');

  single(req, res, (err) => {
    if (err) {
      req.uploadError = err.message || "Erreur lors de l'upload.";
      return next();
    }
    return next();
  });
}

function handleBlogMediaUpload(req, res, next) {
  const single = upload.single('file');

  single(req, res, (err) => {
    if (err) {
      req.uploadError = err.message || "Erreur lors de l'upload.";
      return next();
    }
    return next();
  });
}

module.exports = {
  handleBlogCoverUpload,
  handleBlogMediaUpload,
};
