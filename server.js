const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = 3000;

// ปรับแก้ตั้งค่า CORS ตรงนี้ครับ
app.use(
  cors({
    origin: [
      "https://foodtag-impact.onrender.com", // โดเมนหน้าบ้านของคุณ
      "http://localhost:5500", // สำหรับตอนทดสอบด้วย Live Server
      "http://127.0.0.1:5500",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // จำเป็นต้องใส่บรรทัดนี้เพื่อให้ต่อกับ Supabase ได้
  },
});

// 2. ฟังก์ชันสร้างตารางทั้งหมด และเพิ่มข้อมูลตัวอย่าง
const initDB = async () => {
  try {
    // สร้างตารางพนักงาน
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        emp_id VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL
      );
    `);

    // สร้างตารางเมนู
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menus (
        id SERIAL PRIMARY KEY,
        name_th VARCHAR(255) NOT NULL,
        name_en VARCHAR(255) NOT NULL
      );
    `);

    // สร้างตารางวัตถุดิบ/ภูมิแพ้
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id SERIAL PRIMARY KEY,
        name_th VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NOT NULL,
        icon_url TEXT
      );
    `);

    // สร้างตารางเชื่อมเมนูและส่วนผสม
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_ingredients (
        menu_id INTEGER REFERENCES menus(id),
        ingredient_id INTEGER REFERENCES ingredients(id),
        PRIMARY KEY (menu_id, ingredient_id)
      );
    `);

    // 🆕 สร้างตารางเก็บโปรไฟล์แท็กที่เราจะบันทึก
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tag_profiles (
        id SERIAL PRIMARY KEY,
        profile_name VARCHAR(255) NOT NULL,
        template_size VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS tag_slots (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES tag_profiles(id) ON DELETE CASCADE,
        slot_number INTEGER NOT NULL,
        menu_id INTEGER REFERENCES menus(id)
      );
    `);
    // สร้างตารางเก็บรูปแบบกระดาษและขนาดป้าย
    await pool.query(`
  CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,       -- เช่น 'Coffee Break (ฐานไม้สั้น)'
    width_mm FLOAT,                   -- ความกว้างของป้าย (มม.)
    height_mm FLOAT,                  -- ความสูงของป้าย (มม.)
    orientation VARCHAR(20),          -- 'landscape' หรือ 'portrait'
    slots_count INTEGER DEFAULT 1,    -- จำนวนช่องใน 1 หน้า A4
    grid_class VARCHAR(50)            -- CSS Class สำหรับจัด Layout เช่น 'grid-cols-2'
  );
`);

    // เพิ่มข้อมูลขนาดป้ายจากไฟล์ที่คุณส่งมา (ตัวอย่าง)
    const templateCheck = await pool.query("SELECT count(*) FROM templates");
    if (templateCheck.rows[0].count == 0) {
      await pool.query(`
    INSERT INTO templates (name, width_mm, height_mm, orientation, slots_count, grid_class) VALUES 
    ('Western Set', 105, 148, 'portrait', 4, 'grid-cols-2'),
    ('Coffee Break (ฐานไม้สั้น)', 148, 105, 'landscape', 4, 'grid-cols-2'),
    ('Buffet (สแตนเล็ก)', 102, 97, 'portrait', 6, 'grid-cols-2'),
    ('Food Stall (แสตนแผ่นใหญ่)', 210, 297, 'portrait', 1, 'grid-cols-1')
  `);
    }
    console.log("✅ ตารางข้อมูลทั้งหมดพร้อมใช้งาน!");

    // เพิ่มข้อมูลพนักงานเริ่มต้น
    const userCheck = await pool.query("SELECT count(*) FROM users");
    if (userCheck.rows[0].count == 0) {
      await pool.query(`
        INSERT INTO users (emp_id, password, name, role) VALUES 
        ('EMP001', '123', 'Admin_Siriprapa', 'Admin'),
        ('EMP002', '123', 'Staff_PrintOnly', 'Staff')
      `);
    }

    // เพิ่มข้อมูลเมนูและส่วนผสมตัวอย่าง
    const menuCheck = await pool.query("SELECT count(*) FROM menus");
    if (menuCheck.rows[0].count == 0) {
      await pool.query(
        "INSERT INTO menus (id, name_th, name_en) VALUES (1, 'ทอดมันกุ้ง', 'Deep-fried Prawn Cake'), (2, 'ขนมปังหน้าหมู', 'Fried Pork Toast')",
      );

      await pool.query(
        "INSERT INTO ingredients (id, name_th, name_en, icon_url) VALUES (1, 'กุ้ง', 'Crustaceans', '🦐'), (2, 'ไข่', 'Egg', '🥚'), (3, 'แป้งสาลี', 'Wheat', '🌾')",
      );

      await pool.query(
        "INSERT INTO menu_ingredients (menu_id, ingredient_id) VALUES (1, 1), (1, 2), (2, 2), (2, 3)",
      );

      console.log("✨ เพิ่มข้อมูลเมนูตัวอย่างเรียบร้อย!");
    }
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดใน initDB:", err);
  }
};

// เรียกใช้งานสร้างตาราง
initDB();

// --- 3. เส้น API ต่างๆ ---

// Login API
app.post("/api/login", async (req, res) => {
  const { emp_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE emp_id = $1 AND password = $2",
      [emp_id, password],
    );
    const user = result.rows[0];
    if (user) {
      res.json({
        success: true,
        message: "Login สำเร็จ!",
        userData: { name: user.name, role: user.role, emp_id: user.emp_id },
      });
    } else {
      res.status(401).json({ success: false, message: "รหัสผิดพลาด!" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "เซิร์ฟเวอร์มีปัญหา" });
  }
});

// Search Menu API
app.get("/api/menus/search", async (req, res) => {
  const { q } = req.query;
  try {
    const result = await pool.query(
      `
      SELECT m.*, 
      json_agg(json_build_object('name', i.name_en, 'icon', i.icon_url)) as allergens
      FROM menus m
      LEFT JOIN menu_ingredients mi ON m.id = mi.menu_id
      LEFT JOIN ingredients i ON mi.ingredient_id = i.id
      WHERE m.name_th LIKE $1 OR m.name_en ILIKE $1
      GROUP BY m.id
    `,
      [`%${q}%`],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🆕 Save Tag Profile API (สำหรับปุ่ม Save ในหน้า Create)
app.post("/api/tags/save", async (req, res) => {
  const { profile_name, template_size, slots, created_by } = req.body;
  try {
    const profileRes = await pool.query(
      "INSERT INTO tag_profiles (profile_name, template_size, created_by) VALUES ($1, $2, $3) RETURNING id",
      [profile_name, template_size, created_by],
    );
    const profileId = profileRes.rows[0].id;

    for (const slot of slots) {
      if (slot.menu_id) {
        await pool.query(
          "INSERT INTO tag_slots (profile_id, slot_number, menu_id) VALUES ($1, $2, $3)",
          [profileId, slot.slot_number, slot.menu_id],
        );
      }
    }
    res.json({ success: true, message: "บันทึกข้อมูลแท็กเรียบร้อยแล้ว!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/templates", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM templates ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// สั่งเปิดเซิร์ฟเวอร์
app.listen(port, () => {
  console.log(`🚀 Backend รันอยู่บนพอร์ต ${port} (http://localhost:${port})`);
});
