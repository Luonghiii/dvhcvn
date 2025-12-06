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

// Load data cũ (data.json) - Dùng cho API lấy Huyện/Xã cũ
const dataPath = path.join(__dirname, 'json', 'data.json');
let oldData = [];
try {
    if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf8');
        oldData = JSON.parse(raw);
        console.log(`✅ [DATA CŨ] Đã load ${oldData.length} tỉnh thành.`);
    }
} catch (err) { console.error('❌ Lỗi data.json:', err); }

// Load data mới (data-new.json) - Dùng cho API lấy Xã mới & Convert
const dataNewPath = path.join(__dirname, 'json', 'data-new.json');
let newData = [];
try {
    if (fs.existsSync(dataNewPath)) {
        const rawNew = fs.readFileSync(dataNewPath, 'utf8');
        newData = JSON.parse(rawNew);
        console.log(`✅ [DATA MỚI] Đã load ${newData.length} đơn vị hành chính mới.`);
    }
} catch (err) { console.error('❌ Lỗi data-new.json:', err); }

// --- 2. HÀM TIỆN ÍCH ---

// Hàm chuẩn hóa chuỗi để so sánh (bỏ dấu, chữ thường, bỏ khoảng trắng thừa)
function normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/\s+/g, " ") 
        .trim();
}

// --- 3. API CHÍNH (GIẢ LẬP PHP) ---

app.get('/address-api.php', (req, res) => {
    const action = req.query.action;
    
    // Set Header trả về đúng chuẩn JSON UTF-8
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // =========================================================
    // API 1: TRA CỨU ĐỊA CHỈ CŨ & CHUYỂN ĐỔI SANG MỚI
    // =========================================================

    // ▶ Bước 1: Lấy danh sách Quận/Huyện CŨ (Từ data.json)
    // URL: ?action=districts&province_name=Tỉnh Nghệ An
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

    // ▶ Bước 2: Lấy danh sách Phường/Xã CŨ (Từ data.json)
    // URL: ?action=wards&district_name=...&province_name=...
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

    // ▶ Bước 3: Convert Cũ -> Mới (Tìm trong data-new.json)
    // URL: ?action=convert&old_ward_name=...&old_district_name=...
    if (action === 'convert') {
        const oldW = req.query.old_ward_name;
        const oldD = req.query.old_district_name;
        const oldP = req.query.old_province_name;

        // Duyệt qua file DATA MỚI để tìm lịch sử sáp nhập
        for (const newItem of newData) {
            if (newItem.old_units && Array.isArray(newItem.old_units)) {
                // Kiểm tra xem bộ 3 (Xã, Huyện, Tỉnh cũ) có trong lịch sử của đơn vị mới này không
                const match = newItem.old_units.find(old => 
                    normalizeStr(old.old_ward_name) === normalizeStr(oldW) &&
                    normalizeStr(old.old_district_name) === normalizeStr(oldD)
                );

                if (match) {
                    // Trả về object kết quả duy nhất
                    return res.json({
                        id: newItem.id || Math.floor(Math.random() * 9999).toString(),
                        old_ward_code: match.old_ward_code || "",
                        old_ward_name: oldW,
                        old_district_name: oldD,
                        old_province_name: oldP,
                        new_ward_code: newItem.ward_code || newItem.code,
                        new_ward_name: newItem.ward_name || newItem.new_unit,
                        new_province_name: newItem.province_name,
                        new_province_code: "40", // Ví dụ mã tỉnh
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }
        return res.json({}); // Trả về object rỗng nếu không tìm thấy
    }

    // =========================================================
    // API 2: TRA CỨU ĐỊA CHỈ MỚI & TRA NGƯỢC VỀ CŨ
    // =========================================================

    // ▶ Bước 1: Lấy danh sách Phường/Xã MỚI (Từ data-new.json)
    // URL: ?action=new_wards&province_name=Nghệ An
    if (action === 'new_wards') {
        const pName = req.query.province_name;
        
        // Lọc trong file DATA MỚI
        const results = newData
            .filter(item => item.province_name && normalizeStr(item.province_name).includes(normalizeStr(pName)))
            .map(item => ({ 
                name: item.ward_name // Trả về: [{"name": "Phường Cửa Lò"}, {"name": "Xã An Châu"}...]
            }));
            
        // Sắp xếp theo tên cho đẹp
        results.sort((a, b) => a.name.localeCompare(b.name));
        
        return res.json(results);
    }

    // ▶ Bước 2: Convert Reverse (Mới -> Danh sách Cũ)
    // URL: ?action=convert-reverse&new_ward_name=...&new_province_name=...
    if (action === 'convert-reverse') {
        const newW = req.query.new_ward_name;
        const newP = req.query.new_province_name;

        // Tìm đơn vị mới đích danh trong DATA MỚI
        const target = newData.find(item => 
            (item.ward_name && normalizeStr(item.ward_name) === normalizeStr(newW)) &&
            (item.province_name && normalizeStr(item.province_name).includes(normalizeStr(newP)))
        );

        if (target && target.old_units) {
            // Trả về danh sách các đơn vị cũ: [{"old_ward_name": ...}, ...]
            return res.json(target.old_units);
        }
        
        return res.json([]);
    }

    // Default action
    return res.json({ error: "Action không hợp lệ." });
});

// --- 4. CÁC API KHÁC (GIỮ NGUYÊN ĐỂ KHÔNG LỖI APP CŨ) ---
// (Cậu có thể xóa bớt nếu không dùng)

app.get('/api/provinces', (req, res) => {
    res.json(oldData.map(p => ({ province_code: p.province_code, name: p.name })));
});

// --- 5. FRONTEND STATIC ---

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    // Chỉ trả về index.html nếu không phải là API call
    if (!req.url.includes('api.php')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
