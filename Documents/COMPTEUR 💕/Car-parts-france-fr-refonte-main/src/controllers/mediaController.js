const mongoose = require('mongoose');

const mediaStorage = require('../services/mediaStorage');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getMediaById(req, res, next) {
  try {
    const id = getTrimmedString(req.params && req.params.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).end();
    }

    const file = await mediaStorage.findFileById(id);
    if (!file) {
      return res.status(404).end();
    }

    const contentType = typeof file.contentType === 'string' && file.contentType.trim()
      ? file.contentType.trim()
      : 'application/octet-stream';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');

    const filename = typeof file.filename === 'string' ? file.filename.trim() : '';
    if (filename) {
      res.set('Content-Disposition', `inline; filename="${filename.replace(/\"/g, '')}"`);
    }

    const stream = mediaStorage.openDownloadStream(id);
    stream.on('error', () => {
      res.status(404).end();
    });
    stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getMediaById,
};
