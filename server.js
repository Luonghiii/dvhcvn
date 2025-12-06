const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// --- PHẦN 1: LOAD DỮ LIỆU (Cũ và Mới) ---

// 1.1 Load dữ liệu cũ (data.json) - Dùng cho các API gốc của repo
const dataPath = path.join(__dirname, 'json', 'data.json');
let provinces = [];
try {
  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    provinces = JSON.parse(raw);
    console.log(`✅ Đã load data cũ: ${provinces.length} tỉnh thành.`);
  }
} catch (err) {
  console.error('❌ Lỗi đọc file json/data.json:', err);
}

// 1.2 Load dữ liệu mới (data-new.json) - Dùng cho API giả lập PHP
const dataNewPath = path.join(__dirname, 'json', 'data-new.json');
let dataNew = [];
try {
  if (fs.existsSync(dataNewPath)) {
    const rawNew = fs.readFileSync(dataNewPath, 'utf8');
    dataNew = JSON.parse(rawNew);
    console.log(`✅ Đã load data mới: ${dataNew.length} đơn vị hành chính.`);
  } else {
    console.warn("⚠️ Cảnh báo: Không tìm thấy file json/data-new.json (API mới sẽ không có dữ liệu)");
  }
} catch (err) {
  console.error('❌ Lỗi đọc file json/data-new.json:', err);
}

// --- PHẦN 2: CÁC HÀM TIỆN ÍCH ---

// Hàm loại bỏ dấu tiếng Việt
function removeVietnameseTones(str) {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// --- PHẦN 3: CÁC API GỐC CỦA REPO (Giữ nguyên) ---

// API lấy danh sách tỉnh/thành
app.get('/api/provinces', (req, res) => {
  const result = provinces.map(p => ({
    province_code: p.province_code,
    name: p.name
  }));
  res.json(result);
});

// API lấy danh sách phường/xã theo tỉnh/thành
app.get('/api/wards', (req, res) => {
  const { province_code } = req.query;
  const province = provinces.find(p => p.province_code === province_code);
  if (!province) return res.status(404).json({ error: 'Không tìm thấy tỉnh/thành' });
  res.json(province.wards || []);
});

// API tìm kiếm theo tên tỉnh/thành hoặc phường/xã
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const keyword = q.toLowerCase();
  const keywordNoSign = removeVietnameseTones(keyword);
  let results = [];
  
  provinces.forEach(p => {
    const nameLower = p.name.toLowerCase();
    const nameNoSign = removeVietnameseTones(nameLower);
    if (nameLower.includes(keyword) || nameNoSign.includes(keywordNoSign)) {
      results.push({
        type: 'province',
        province_code: p.province_code,
        name: p.name
      });
    }
    (p.wards || []).forEach(w => {
      const wNameLower = w.name.toLowerCase();
      const wNameNoSign = removeVietnameseTones(wNameLower);
      if (wNameLower.includes(keyword) || wNameNoSign.includes(keywordNoSign)) {
        results.push({
          type: 'ward',
          province_code: p.province_code,
          ward_code: w.ward_code,
          name: w.name,
          province_name: p.name
        });
      }
    });
  });
  res.json(results);
});

// API thống kê
app.get('/api/stats', (req, res) => {
  const { province_code } = req.query;
  const numProvinces = provinces.length;
  let numWards = 0;
  provinces.forEach(p => {
    numWards += (p.wards ? p.wards.length : 0);
  });
  let currentWards = 0;
  if (province_code) {
    const province = provinces.find(p => p.province_code === province_code);
    currentWards = province && province.wards ? province.wards.length : 0;
  }
  res.json({
    numProvinces,
    numWards,
    currentWards
  });
});

// --- PHẦN 4: API GIẢ LẬP PHP (CẬP NHẬT MỚI) ---

app.get('/address-api.php', (req, res) => {
    const action = req.query.action;
    const province_name = req.query.province_name;

    // Cấu hình header JSON và UTF-8
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cho phép gọi API từ domain khác (CORS đơn giản)
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!province_name) {
        return res.json({ error: "Thiếu tham số province_name" });
    }

    // Chuẩn hóa tên tỉnh để tìm kiếm (Vd: "Tỉnh Nghệ An" -> "nghệ an")
    const searchName = province_name.toLowerCase().replace(/^(tỉnh|thành phố)\s+/i, '').trim();

    // Lọc dữ liệu từ file DATA-NEW.JSON theo tên tỉnh
    const provinceDataNew = dataNew.filter(item => {
        const pName = item.province_name ? item.province_name.toLowerCase() : '';
        return pName === searchName || pName.includes(searchName);
    });

    // CASE 1: Lấy danh sách các đơn vị hành chính (Districts/Wards)
    if (action === 'districts') {
        // Trả về dữ liệu từ data-new.json như yêu cầu
        return res.json(provinceDataNew.map(item => ({
            code: item.ward_code,
            name: item.ward_name,
            district: item.district_name || "Chưa cập nhật", // Thêm dòng này nếu data có
            province: item.province_name
        })));
    }

    // CASE 2: Lấy danh sách các đơn vị mới sáp nhập (New Wards)
    if (action === 'new_wards') {
        // Chỉ lấy những dòng có has_merger = true
        const newWards = provinceDataNew
            .filter(item => item.has_merger === true)
            .map(item => ({
                new_unit: item.ward_name,
                code: item.ward_code,
                old_units: item.old_units,
                merger_details: item.merger_details
            }));
        
        return res.json(newWards);
    }

    // Mặc định trả về rỗng nếu không đúng action
    res.json([]);
});

// --- PHẦN 5: CHẠY SERVER ---

// Phục vụ file tĩnh frontend
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`👉 Test API Quận/Huyện: http://localhost:${PORT}/address-api.php?action=districts&province_name=Nghệ An`);
  console.log(`👉 Test API Sáp nhập:   http://localhost:${PORT}/address-api.php?action=new_wards&province_name=Nghệ An`);
});
