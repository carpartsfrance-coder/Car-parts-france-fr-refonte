const multer = require('multer');

const storage = multer.memoryStorage();

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
