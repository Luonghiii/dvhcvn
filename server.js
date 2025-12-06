const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- 1. LOAD DỮ LIỆU ---

// Load data cũ (data.json) - Dùng để tra cứu thông tin Huyện/Tỉnh cũ
const dataPath = path.join(__dirname, 'json', 'data.json');
let oldData = [];
try {
    if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf8');
        oldData = JSON.parse(raw);
        console.log(`✅ [DATA CŨ] Đã load ${oldData.length} tỉnh thành.`);
    }
} catch (err) { console.error('❌ Lỗi data.json:', err); }

// Load data mới (data-new.json) - Dùng để lấy thông tin đơn vị mới & sáp nhập
const dataNewPath = path.join(__dirname, 'json', 'data-new.json');
let newData = [];
try {
    if (fs.existsSync(dataNewPath)) {
        const rawNew = fs.readFileSync(dataNewPath, 'utf8');
        newData = JSON.parse(rawNew);
        console.log(`✅ [DATA MỚI] Đã load ${newData.length} đơn vị hành chính mới.`);
    }
} catch (err) { console.error('❌ Lỗi data-new.json:', err); }

// --- 2. CÁC HÀM TIỆN ÍCH ---

// Hàm chuẩn hóa chuỗi (chữ thường, bỏ dấu, bỏ khoảng trắng thừa)
function normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/\s+/g, " ")
        .trim();
}

// Hàm hỗ trợ API gốc (chỉ bỏ dấu, giữ hoa thường)
function removeVietnameseTones(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Hàm thông minh: Tìm Huyện và Tỉnh của một Xã cũ dựa trên tên Xã và Tỉnh gợi ý.
 * Dùng để xử lý trường hợp old_units chỉ chứa mảng tên xã (String).
 */
function findParentInfo(wardName, provinceNameHint) {
    // 1. Lọc danh sách tỉnh trong data cũ dựa trên gợi ý (nếu có)
    let targetProvinces = oldData;
    if (provinceNameHint) {
        const normHint = normalizeStr(provinceNameHint).replace("tinh", "").trim();
        targetProvinces = oldData.filter(p => normalizeStr(p.name).includes(normHint));
    }

    // 2. Duyệt sâu vào từng Huyện -> Xã để tìm tên xã khớp
    for (const province of targetProvinces) {
        if (!province.districts) continue;
        for (const district of province.districts) {
            if (!district.wards) continue;
            
            // So sánh tên xã
            const found = district.wards.find(w => normalizeStr(w.name) === normalizeStr(wardName));
            if (found) {
                return {
                    district: district.name,
                    province: province.name
                };
            }
        }
    }
    // Nếu không tìm thấy
    return { district: "Đang cập nhật", province: provinceNameHint || "Đang cập nhật" };
}

// --- 3. CÁC API GỐC CỦA REPO (Giữ nguyên để App cũ không lỗi) ---

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

// --- 4. API GIẢ LẬP PHP (FULL LOGIC MỚI) ---

app.get('/address-api.php', (req, res) => {
    const action = req.query.action;
    
    // Set Header JSON & UTF-8 & CORS
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // =========================================================
    // API 1: TRA CỨU ĐỊA CHỈ CŨ (Dùng data.json)
    // =========================================================

    // ▶ 1.1 Lấy danh sách Quận/Huyện CŨ
    if (action === 'districts') {
        const pName = req.query.province_name;
        if (!pName) return res.json([]);

        // Tìm trong file DATA CŨ
        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        
        if (province && province.districts) {
            // Trả về: [{"name": "Huyện Anh Sơn"}, ...]
            return res.json(province.districts.map(d => ({ name: d.name })));
        }
        return res.json([]);
    }

    // ▶ 1.2 Lấy danh sách Phường/Xã CŨ
    if (action === 'wards') {
        const pName = req.query.province_name;
        const dName = req.query.district_name;

        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        if (province && province.districts) {
            const district = province.districts.find(d => normalizeStr(d.name) === normalizeStr(dName));
            if (district && district.wards) {
                // Trả về: [{"name": "Xã Tây Hiếu"}, ...]
                return res.json(district.wards.map(w => ({ name: w.name })));
            }
        }
        return res.json([]);
    }

    // ▶ 1.3 Convert Cũ -> Mới (Tìm trong data-new.json)
    if (action === 'convert') {
        const oldW = req.query.old_ward_name;
        
        // Duyệt qua file DATA MỚI
        for (const newItem of newData) {
            if (newItem.old_units && Array.isArray(newItem.old_units)) {
                // Kiểm tra xem old_ward_name có nằm trong mảng chuỗi old_units không
                // Ví dụ: old_units = ["Thị trấn Thứ Ba", "Xã Đông Yên"]
                const match = newItem.old_units.find(u => normalizeStr(u) === normalizeStr(oldW));
                
                if (match) {
                    return res.json({
                        id: newItem.id || Math.floor(Math.random() * 9999).toString(),
                        old_ward_name: oldW,
                        old_district_name: req.query.old_district_name,
                        old_province_name: req.query.old_province_name,
                        new_ward_code: newItem.ward_code || newItem.code,
                        new_ward_name: newItem.ward_name || newItem.new_unit,
                        new_province_name: newItem.province_name,
                        new_province_code: newItem.province_code || "40",
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }
        return res.json({}); // Không tìm thấy
    }

    // =========================================================
    // API 2: TRA CỨU ĐỊA CHỈ MỚI (Dùng data-new.json)
    // =========================================================

    // ▶ 2.1 Lấy danh sách Phường/Xã MỚI
    if (action === 'new_wards') {
        const pName = req.query.province_name;
        
        // Lọc trong file DATA MỚI
        const results = newData
            .filter(item => item.province_name && normalizeStr(item.province_name).includes(normalizeStr(pName)))
            .map(item => ({ 
                name: item.ward_name // Trả về: [{"name": "Phường Cửa Lò"}, ...]
            }));
            
        // Sắp xếp theo tên
        results.sort((a, b) => a.name.localeCompare(b.name));
        
        return res.json(results);
    }

    // ▶ 2.2 Convert Reverse: Mới -> Danh sách Cũ (CHI TIẾT ĐẦY ĐỦ)
    if (action === 'convert-reverse') {
        const newW = req.query.new_ward_name;
        const newP = req.query.new_province_name;

        // 1. Tìm đơn vị mới đích danh
        const target = newData.find(item => 
            (item.ward_name && normalizeStr(item.ward_name) === normalizeStr(newW)) &&
            (item.province_name && normalizeStr(item.province_name).includes(normalizeStr(newP)))
        );

        // 2. Nếu tìm thấy và có danh sách cũ (dạng mảng chuỗi)
        if (target && target.old_units && Array.isArray(target.old_units)) {
            // Biến đổi từng chuỗi tên xã thành Object đầy đủ thông tin bằng cách tra cứu data cũ
            const result = target.old_units.map(unitNameString => {
                // Tự động tìm Huyện/Tỉnh tương ứng trong data.json
                const parentInfo = findParentInfo(unitNameString, target.province_name);
                
                return {
                    old_ward_name: unitNameString,          // Ví dụ: "Thị trấn Thứ Ba"
                    old_district_name: parentInfo.district,   // Ví dụ: "Huyện An Biên" (Tự tìm ra)
                    old_province_name: parentInfo.province    // Ví dụ: "Tỉnh Kiên Giang" (Tự tìm ra)
                };
            });
            
            return res.json(result);
        }
        
        return res.json([]);
    }

    // Default action
    return res.json({ error: "Action không hợp lệ." });
});

// --- 5. FRONTEND STATIC ---

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    // Chỉ trả về index.html nếu không phải là API call
    if (!req.url.includes('api.php') && !req.url.includes('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
