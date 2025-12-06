const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- 1. LOAD DỮ LIỆU ---
const dataPath = path.join(__dirname, 'json', 'data.json');
let oldData = [];
try {
    if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf8');
        oldData = JSON.parse(raw);
        console.log(`✅ [DATA CŨ] Đã load ${oldData.length} tỉnh thành.`);
    }
} catch (err) { console.error('❌ Lỗi data.json:', err); }

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
function normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/\s+/g, " ")
        .trim();
}

// Hàm tìm thông tin Huyện/Tỉnh từ tên Xã (trong data cũ)
function findOldUnitInfo(wardName, provinceHint) {
    const normWardName = normalizeStr(wardName);
    // Lọc tỉnh nếu có gợi ý để tìm nhanh hơn
    let searchProvinces = oldData;
    if (provinceHint) {
        const normProvHint = normalizeStr(provinceHint);
        searchProvinces = oldData.filter(p => normalizeStr(p.name).includes(normProvHint) || normProvHint.includes(normalizeStr(p.name)));
    }

    for (const province of searchProvinces) {
        if (!province.districts) continue;
        for (const district of province.districts) {
            if (!district.wards) continue;
            // Tìm xã trong huyện
            const foundWard = district.wards.find(w => normalizeStr(w.name) === normWardName);
            if (foundWard) {
                return {
                    old_ward_name: foundWard.name,      // Tên xã cũ chính xác từ data
                    old_district_name: district.name,   // Tên huyện cũ
                    old_province_name: province.name    // Tên tỉnh cũ
                };
            }
        }
    }
    // Fallback nếu không tìm thấy: trả về như cũ nhưng báo chưa rõ
    return {
        old_ward_name: wardName,
        old_district_name: "Chưa rõ huyện",
        old_province_name: provinceHint || "Chưa rõ tỉnh"
    };
}

// --- 3. API CHÍNH ---

app.get('/address-api.php', (req, res) => {
    const action = req.query.action;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // API 1: TRA CỨU CŨ
    if (action === 'districts') {
        const pName = req.query.province_name;
        if (!pName) return res.json([]);
        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        if (province && province.districts) {
            return res.json(province.districts.map(d => ({ name: d.name })));
        }
        return res.json([]);
    }

    if (action === 'wards') {
        const pName = req.query.province_name;
        const dName = req.query.district_name;
        const province = oldData.find(p => normalizeStr(p.name).includes(normalizeStr(pName)));
        if (province && province.districts) {
            const district = province.districts.find(d => normalizeStr(d.name) === normalizeStr(dName));
            if (district && district.wards) {
                return res.json(district.wards.map(w => ({ name: w.name })));
            }
        }
        return res.json([]);
    }

    // API 2: MỚI & CONVERT
    if (action === 'new_wards') {
        const pName = req.query.province_name;
        const results = newData
            .filter(item => item.province_name && normalizeStr(item.province_name).includes(normalizeStr(pName)))
            .map(item => ({ name: item.ward_name }));
        results.sort((a, b) => a.name.localeCompare(b.name));
        return res.json(results);
    }

    // ▶ CONVERT REVERSE (SỬA LỖI)
    if (action === 'convert-reverse') {
        const newW = req.query.new_ward_name;
        const newP = req.query.new_province_name;

        // 1. Tìm đơn vị mới trong data-new.json
        const target = newData.find(item => 
            (item.ward_name && normalizeStr(item.ward_name) === normalizeStr(newW)) &&
            (item.province_name && normalizeStr(item.province_name).includes(normalizeStr(newP)))
        );

        // 2. Nếu tìm thấy và có danh sách cũ (mảng chuỗi)
        if (target && target.old_units && Array.isArray(target.old_units)) {
            // Duyệt qua từng tên xã cũ trong mảng
            const result = target.old_units.map(unitNameString => {
                // Gọi hàm tìm kiếm thông tin đầy đủ từ data cũ
                return findOldUnitInfo(unitNameString, target.province_name);
            });
            return res.json(result);
        }
        return res.json([]);
    }

    // Convert xuôi (Cũ -> Mới) - Giữ nguyên logic nếu cần
    if (action === 'convert') {
        // ... (Logic convert xuôi giữ nguyên hoặc thêm nếu cần)
         return res.json({});
    }

    res.json({ error: "Action không hợp lệ." });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    if (!req.url.includes('api.php')) res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
