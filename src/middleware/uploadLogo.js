const path = require('path');
const multer = require('multer');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../public/uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const safeExt = allowed.includes(ext) ? ext : '.png';
    cb(null, `logo-${Date.now()}${safeExt}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase().slice(1));
  if (ok) cb(null, true);
  else cb(new Error('نوع الملف غير مدعوم'));
}

const uploadLogo = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

module.exports = { uploadLogo };
