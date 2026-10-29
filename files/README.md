# MC Rubber - ระบบออกบิลเชื่อม Google Sheets

ไฟล์ในชุดนี้:
- `Code.gs` — backend (Google Apps Script) เชื่อมกับ Google Sheets 2 ไฟล์
- `Index.html` — หน้าเว็บแอป มี 3 แท็บ: ออกบิล / เพิ่มลูกค้าใหม่ / ค้นหาสินค้า
- `appsscript.json` — manifest ของโปรเจกต์

## ✅ ข้อมูล Google Sheets ที่เชื่อมไว้

| Sheet | Spreadsheet ID | GID | หัวคอลัมน์ |
|-------|----------------|-----|------------|
| **Customer** | `10CKvV_LlHRoc__qRw7nulocCu4kuO92eNlBiRBVn2zw` | `97443798` | `ID`, `Name`, `TaxID`, `Address1`, `Address2` |
| **Input** (สินค้า) | `1O2c_iDKBYkbFNC0NIEopu2jRcUpBA-4php69c0S4lWc` | `827458846` | `MC Product`, `ชื่อสินค้า`, `ราคา`, `หน่วย` |
| **บันทึกบิล** (auto-create) | เดียวกับ Customer | — | สร้างให้อัตโนมัติ |

> **ข้อมูลทั้งหมดยืนยันจากเจ้าของชีตแล้ว** — `Code.gs` พร้อมใช้งานโดยไม่ต้องแก้ไขเพิ่มเติม

## ขั้นตอนติดตั้ง (ใช้ clasp)

1. สร้างโปรเจกต์ Apps Script ใหม่ (standalone ก็ได้ ไม่จำเป็นต้องผูกกับชีตใดชีตหนึ่ง
   เพราะเราระบุ Spreadsheet ID ตรงๆ ใน CONFIG แล้ว):
   ```
   clasp create --type webapp --title "MC Rubber - ระบบออกบิล"
   ```
2. คัดลอกไฟล์ `Code.gs`, `Index.html`, `appsscript.json` ลงในโฟลเดอร์โปรเจกต์
3. Push ขึ้น Apps Script:
   ```
   clasp push
   ```
4. Deploy เป็น Web App:
   ```
   clasp deploy
   ```
   หรือเปิด Apps Script Editor > Deploy > New deployment > Web app
   - Execute as: **User accessing the web app** (หรือ Me ถ้าต้องการให้รันด้วยสิทธิ์คุณเสมอ)
   - Who has access: จำกัดเฉพาะคนในองค์กร/บัญชีที่กำหนด
5. เปิด URL ที่ได้ ครั้งแรกจะมีหน้าต่างขอ authorize สิทธิ์เข้าถึง Google Sheets — กด Allow

## สิ่งที่ระบบทำให้

- **แท็บออกบิล**: เลือกลูกค้าจาก dropdown (ดึงจากชีต Customer), พิมพ์ชื่อสินค้าจะมี
  autocomplete จากชีต Input (ราคา/หน่วย/รหัส MC เติมให้อัตโนมัติ), กด "บันทึกลง Sheet"
  จะเขียนแถวบิลลงแท็บใหม่ชื่อ **"บันทึกบิล"** ในไฟล์ลูกค้า (สร้างให้อัตโนมัติถ้ายังไม่มี)
- **แท็บเพิ่มลูกค้าใหม่**: กรอกชื่อ / เลขภาษี / ที่อยู่ 1 / ที่อยู่ 2 แล้วบันทึก
  ระบบจะสร้างรหัสลูกค้าใหม่ให้อัตโนมัติ (รูปแบบ C0001, C0002, ...) แล้ว append
  แถวใหม่ต่อท้ายชีต Customer
- **แท็บค้นหาสินค้า**: ดึงสินค้าทั้งหมดจากชีต Input มาแสดงเป็นตาราง ค้นหาได้จาก
  ชื่อสินค้า / รหัส MC Product / หน่วย แบบเรียลไทม์

## จุดที่ปรับแต่งต่อได้ในอนาคต

- ถ้าอยากบันทึกบิลลงไฟล์อื่น (ไม่ใช่ไฟล์ลูกค้า) แก้ `INVOICE_LOG_SPREADSHEET_ID`
  และ `INVOICE_LOG_SHEET_NAME` ใน `Code.gs`
- ถ้ารหัสลูกค้าอยากใช้รูปแบบอื่น (ไม่ใช่ C0001) แก้ในฟังก์ชัน `addCustomer()`
- ตอนนี้เลขที่บิล (orderNo) ยังพิมพ์เองอยู่ ถ้าต้องการให้ auto-generate ต่อจาก
  เลขล่าสุดในชีต "บันทึกบิล" บอกได้ เดี๋ยวเพิ่มให้

