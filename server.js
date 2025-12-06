const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware xử lý JSON body
app.use(express.json());

// --- PHẦN 1: LOAD DỮ LIỆU ---

// 1.1 Load dữ liệu cũ (data.json) - Cấu trúc: Tỉnh -> Huyện -> Xã
const dataPath = path.join(__dirname, 'json', 'data.json');
let oldData = []; // Dữ liệu cũ
try {
  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    oldData = JSON.parse(raw);
    console.log(`✅ [OLD DATA] Đã load ${oldData.length} tỉnh thành từ data.json`);
  }
} catch (err) {
  console.error('❌ Lỗi đọc file json/data.json:', err);
}

// 1.2 Load dữ liệu mới (data-new.json) - Cấu trúc phẳng + lịch sử sáp nhập
const dataNewPath = path.join(__dirname, 'json', 'data-new.json');
let newData = []; // Dữ liệu mới
try {
  if (fs.existsSync(dataNewPath)) {
    const rawNew = fs.readFileSync(dataNewPath, 'utf8');
    newData = JSON.parse(rawNew);
    console.log(`✅ [NEW DATA] Đã load ${newData.length} đơn vị từ data-new.json`);
  } else {
    console.warn("⚠️ Cảnh báo: Không tìm thấy file json/data-new.json");
  }
} catch (err) {
  console.error('❌ Lỗi đọc file json/data-new.json:', err);
}

// --- PHẦN 2: HÀM TIỆN ÍCH ---

// Hàm chuẩn hóa chuỗi để so sánh (bỏ dấu, chữ thường, bỏ khoảng trắng thừa)
function normalizeStr(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ") // Gộp nhiều khoảng trắng thành 1
    .trim();
}

// Hàm hỗ trợ API gốc (chỉ loại bỏ dấu cơ bản)
function removeVietnameseTones(str) {
  return str.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// --- PHẦN 3: CÁC API GỐC CỦA REPO (Giữ nguyên để web cũ không lỗi) ---

app.get('/api/provinces', (req, res) => {
  const result = oldData.map(p => ({ province_code: p.province_code, name: p.name }));
  res.json(result);
});

app.get('/api/wards', (req, res) => {
  const { province_code } = req.query;
  const province = oldData.find(p => p.province_code === province_code);
  if (!province) return res.status(404).json({ error: 'Không tìm thấy tỉnh/thành' });
  res.json(province.wards || []);
});

app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const keyword = q.toLowerCase();
  const keywordNoSign = removeVietnameseTones(keyword);
  let results = [];
  oldData.forEach(p => {
    const nameLower = p.name.toLowerCase();
    if (nameLower.includes(keyword) || removeVietnameseTones(nameLower).includes(keywordNoSign)) {
      results.push({ type: 'province', province_code: p.province_code, name: p.name });
    }
    (p.wards || []).forEach(w => {
      const wNameLower = w.name.toLowerCase();
      if (wNameLower.includes(keyword) || removeVietnameseTones(wNameLower).includes(keywordNoSign)) {
        results.push({ type: 'ward', province_code: p.province_code, ward_code: w.ward_code, name: w.name, province_name: p.name });
      }
    });
  });
  res.json(results);
});

app.get('/api/stats', (req, res) => {
  const { province_code } = req.query;
  const numProvinces = oldData.length;
  let numWards = 0;
  oldData.forEach(p => { numWards += (p.wards ? p.wards.length : 0); });
  let currentWards = 0;
  if (province_code) {
    const province = oldData.find(p => p.province_code === province_code);
    currentWards = province && province.wards ? province.wards.length : 0;
  }
  res.json({ numProvinces, numWards, currentWards });
});

// --- PHẦN 4: API GIẢ LẬP PHP (FULL LOGIC MỚI) ---

app.get('/address-api.php', (req, res) => {
    const action = req.query.action;
    
    // Header chuẩn để tránh lỗi CORS và font chữ
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // --- CASE 1: Lấy danh sách Quận/Huyện (Dùng data CŨ) ---
    // URL: ?action=districts&province_name=Tỉnh Nghệ An
    if (action === 'districts') {
        const pName = req.query.province_name;
        if (!pName) return res.json([]);

        // Tìm tỉnh trong data cũ
        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        
        if (province && province.districts) {
            // Trả về: [{"name": "Huyện A"}, {"name": "Huyện B"}]
            return res.json(province.districts.map(d => ({ name: d.name })));
        }
        return res.json([]);
    }

    // --- CASE 2: Lấy danh sách Phường/Xã (Dùng data CŨ) ---
    // URL: ?action=wards&district_name=Thị xã Thái Hoà&province_name=Tỉnh Nghệ An
    if (action === 'wards') {
        const pName = req.query.province_name;
        const dName = req.query.district_name;

        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        if (province && province.districts) {
            const district = province.districts.find(d => normalizeStr(d.name) === normalizeStr(dName));
            if (district && district.wards) {
                // Trả về: [{"name": "Xã A"}, {"name": "Phường B"}]
                return res.json(district.wards.map(w => ({ name: w.name })));
            }
        }
        return res.json([]);
    }

    // --- CASE 3: Convert (Cũ -> Mới) ---
    // URL: ?action=convert&old_ward_name=...&old_district_name=...
    if (action === 'convert') {
        const oldW = req.query.old_ward_name;
        const oldD = req.query.old_district_name;
        const oldP = req.query.old_province_name;

        if (!newData.length) return res.json({ error: "Chưa có dữ liệu mới (data-new.json)" });

        let foundResult = null;

        // Duyệt qua tất cả các đơn vị hành chính mới
        for (const newItem of newData) {
            // Kiểm tra xem đơn vị mới này có chứa danh sách 'old_units' không
            if (newItem.old_units && Array.isArray(newItem.old_units)) {
                // Tìm xem bộ ba (Xã, Huyện, Tỉnh) cũ có nằm trong lịch sử của đơn vị mới này không
                const match = newItem.old_units.find(old => 
                    normalizeStr(old.old_ward_name) === normalizeStr(oldW) &&
                    normalizeStr(old.old_district_name) === normalizeStr(oldD)
                );

                if (match) {
                    // Tìm thấy! Trả về thông tin mapping đầy đủ
                    foundResult = {
                        id: newItem.id || "FAKE_ID_" + Math.floor(Math.random() * 1000),
                        old_ward_code: match.old_ward_code || "",
                        old_ward_name: oldW,
                        old_district_name: oldD,
                        old_province_name: oldP,
                        new_ward_code: newItem.code || newItem.ward_code,
                        new_ward_name: newItem.ward_name || newItem.new_unit,
                        new_province_name: newItem.province_name,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    break; 
                }
            }
        }

        if (!foundResult) {
             return res.json({ message: "Không tìm thấy thông tin sáp nhập cho đơn vị này." });
        }
        return res.json(foundResult);
    }

    // --- CASE 4: Lấy danh sách Phường/Xã MỚI (Dùng data MỚI) ---
    // URL: ?action=new_wards&province_name=Nghệ An
    if (action === 'new_wards') {
        const pName = req.query.province_name;
        
        // Lọc trong file data-new.json
        const results = newData
            .filter(item => item.province_name && normalizeStr(item.province_name).includes(normalizeStr(pName)))
            .map(item => ({
                name: item.ward_name || item.new_unit // Trả về list tên phường xã mới
            }));
            
        return res.json(results);
    }

    // --- CASE 5: Convert Reverse (Mới -> Danh sách Cũ) ---
    // URL: ?action=convert-reverse&new_ward_name=...&new_province_name=...
    if (action === 'convert-reverse') {
        const newW = req.query.new_ward_name;
        const newP = req.query.new_province_name;

        // Tìm đơn vị mới đích danh
        const target = newData.find(item => 
            (item.ward_name && normalizeStr(item.ward_name) === normalizeStr(newW)) &&
            (item.province_name && normalizeStr(item.province_name).includes(normalizeStr(newP)))
        );

        if (target && target.old_units) {
            // Trả về danh sách các xã cũ đã gộp vào nó
            return res.json(target.old_units);
        }
        
        return res.json([]);
    }

    // Default action
    return res.json({ error: "Action không hợp lệ hoặc thiếu tham số." });
});

// --- PHẦN 5: FRONTEND STATIC ---

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

// Khởi động server
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
