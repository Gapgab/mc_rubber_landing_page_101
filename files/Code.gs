// ==========================================
//  Code.gs — Backend หลักของ Web App
//  ระบบใบกำกับภาษี
// ==========================================

const SPREADSHEET_ID          = '1IgLzTEc2xNKF2_M-6o08-zhXC4sEu0b3uiq9RxijM0c'; // ไฟล์สั่งซื้อ / สินค้าอ้างอิง
const SPREADSHEET_CUSTOMER_ID = '10CKvV_LlHRoc__qRw7nulocCu4kuO92eNlBiRBVn2zw'; // ไฟล์ฐานข้อมูลลูกค้า (URL: https://docs.google.com/spreadsheets/d/10CKvV_LlHRoc__qRw7nulocCu4kuO92eNlBiRBVn2zw/)
const SHEET_CUSTOMERS_GID     = 97443798;                                        // gid แท็บ Customer
const SHEET_CUSTOMERS         = 'Customer';
const SHEET_ORDERS            = 'รายการสั่งซื้อ';

// ---------- Entry Point ----------
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'index';
  let template;
  if (page === 'print') {
    template = HtmlService.createTemplateFromFile('print.html');
    template.dataJson = ((e && e.parameter && e.parameter.data) || '{}').replace(/<\/script/gi, '<\\/script');
  } else {
    template = HtmlService.createTemplateFromFile('index.html');
  }
  try {
    template.webAppUrl = ScriptApp.getService().getUrl();
  } catch(err) {
    template.webAppUrl = '';
  }
  return template.evaluate()
    .setTitle(page === 'print' ? 'พิมพ์ใบกำกับภาษี' : 'ระบบใบกำกับภาษี')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Include HTML partials ----------
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename + '.html').getContent();
}

// ---------- ดึงข้อมูลเริ่มต้น (รวดเร็ว < 1 วินาที: เฉพาะลูกค้า และ รายการสินค้า) ----------
function getBothData() {
  try {
    var ssOrders = SpreadsheetApp.openById(SPREADSHEET_ID);
    var products = getProducts(ssOrders);

    var customers = [];
    try {
      var ssCust = SpreadsheetApp.openById(SPREADSHEET_CUSTOMER_ID);
      customers = getCustomers(ssCust);
    } catch(errCust) {
      Logger.log('getCustomers from SPREADSHEET_CUSTOMER_ID error: ' + errCust);
    }

    // ถ้าในชีตลูกค้าใหม่ยังไม่มีข้อมูล หรืออ่านไม่ได้ ให้ fallback ไปอ่านจากชีตเดิม
    if (!customers || customers.length === 0) {
      try {
        customers = getCustomers(ssOrders);
      } catch(errOld) {}
    }

    return {
      success  : true,
      customers: customers,
      products : products
    };
  } catch(e) {
    Logger.log('getBothData error: ' + e);
    return {
      success  : false,
      error    : e.toString(),
      customers: [],
      products : []
    };
  }
}

// ==========================================
//  ฟังก์ชันแปลงราคา/ตัวเลข (ลบ ฿, ลูกน้ำ, ช่องว่าง)
// ==========================================
function parsePrice(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var s = String(val).replace(/[^0-9.-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseQty(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return isNaN(val) ? '' : val;
  var s = String(val).replace(/[^0-9.-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? '' : n;
}

var thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function formatYearMonth(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.getFullYear() + '-' + thaiMonths[val.getMonth()];
  }
  return String(val).trim();
}

function extractYear(val) {
  if (!val) return null;
  if (val instanceof Date) {
    var y = val.getFullYear();
    if (y > 2400) y -= 543;
    return y;
  }
  if (typeof val === 'number') {
    if (val >= 2000 && val <= 2100) return val;
    if (val >= 2540 && val <= 2640) return val - 543;
    try {
      var d = new Date(val);
      if (!isNaN(d.getTime())) {
        var dy = d.getFullYear();
        if (dy > 2400) dy -= 543;
        return dy;
      }
    } catch(e) {}
  }
  if (typeof val === 'string') {
    var s = val.trim();
    var m = s.match(/\b(20\d\d|25\d\d)\b/);
    if (m) {
      var yNum = parseInt(m[1], 10);
      if (yNum > 2400) yNum -= 543;
      return yNum;
    }
    try {
      var d2 = new Date(s);
      if (!isNaN(d2.getTime())) {
        var dy2 = d2.getFullYear();
        if (dy2 > 2400) dy2 -= 543;
        return dy2;
      }
    } catch(e2) {}
  }
  return null;
}

// ==========================================
//  ดึงรายการปีทั้งหมดที่มีข้อมูลใน Sheet Ref (เรียงจากปีล่าสุดไปเก่าสุด)
// ==========================================
function getAvailableYears() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var values = getRefData(ss);
    if (!values || values.length === 0) {
      return [new Date().getFullYear()];
    }

    var startRow = 0;
    if (values.length > 0 && typeof values[0][0] === 'string' && /date|วัน|doc|เลข|ลำดับ|#/i.test(values[0][0])) {
      startRow = 1;
    } else if (values.length > 0 && typeof values[0][1] === 'string' && /product|รายการ|สินค้า/i.test(values[0][1])) {
      startRow = 1;
    }

    var yearMap = {};
    for (var i = startRow; i < values.length; i++) {
      var row = values[i];
      if (!row || row.length === 0) continue;
      var dateVal = row[0];
      var y = extractYear(dateVal);
      if (y && y >= 2000 && y <= 2100) {
        yearMap[y] = true;
      }
    }

    var years = Object.keys(yearMap).map(function(y) {
      return parseInt(y, 10);
    });

    years.sort(function(a, b) {
      return b - a; // ล่าสุดไปเก่าสุด
    });

    if (years.length === 0) {
      years.push(new Date().getFullYear());
    }

    Logger.log('getAvailableYears: ' + JSON.stringify(years));
    return years;
  } catch(e) {
    Logger.log('getAvailableYears error: ' + e);
    return [new Date().getFullYear()];
  }
}

// ==========================================
//  ดึงข้อมูลจาก Sheet Ref (กรองตามปี เพื่อความรวดเร็ว)
// ==========================================
function getAllRefPriceData(year) {
  try {
    var isAll = (year === 'all' || year === 'ALL');
    var targetYear = null;
    if (!isAll) {
      targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var values = getRefData(ss);
    if (!values || values.length === 0) return [];

    var startRow = 0;
    if (values.length > 0 && typeof values[0][0] === 'string' && /date|วัน|doc|เลข|ลำดับ|#/i.test(values[0][0])) {
      startRow = 1;
    } else if (values.length > 0 && typeof values[0][1] === 'string' && /product|รายการ|สินค้า/i.test(values[0][1])) {
      startRow = 1;
    }

    var list = [];
    for (var i = startRow; i < values.length; i++) {
      var row = values[i];
      if (!row || row.length < 2) continue;

      var dateVal = row[0];

      // กรองเฉพาะแถวที่ปีตรงกับ targetYear (ถ้าไม่ได้เลือกดูทุกปี)
      if (!isAll && targetYear) {
        var rowYear = extractYear(dateVal);
        if (rowYear && rowYear !== targetYear) {
          continue;
        }
      }

      var custNo = '';
      var custName = '';
      var prodVal = '';
      var qtyVal = '';
      var unitVal = 'ชิ้น';
      var priceVal = 0;

      if (row.length >= 7 && row[6] && String(row[6]).trim().length > 0) {
        // รูปแบบ Sheet Ref คอลัมน์มาตรฐาน:
        // A=Date, C=CustNo, E=CustName, G=Prod, I=Qty, J=Unit, K=Price
        var c2 = String(row[2] || '').trim(); // Col C
        var c4 = String(row[4] || '').trim(); // Col E
        custNo   = c2 || c4 || '-';
        custName = c4 || c2 || '-';

        prodVal  = String(row[6] || '').trim();
        qtyVal   = parseQty(row[8]);
        unitVal  = (row[9] !== undefined ? String(row[9]).trim() : '') || 'ชิ้น';
        priceVal = parsePrice(row[10]);
      } else if (row.length >= 5) {
        // รูปแบบ 5 คอลัมน์ (query1: A=Date, B=Product, C=Qty, D=Unit, E=Price)
        prodVal  = String(row[1] || '').trim();
        qtyVal   = parseQty(row[2]);
        unitVal  = (row[3] !== undefined ? String(row[3]).trim() : '') || 'ชิ้น';
        priceVal = parsePrice(row[4]);
      }

      if (!prodVal || prodVal === '-' || prodVal === '#N/A' || prodVal === '#VALUE!' || prodVal === '#REF!') continue;

      var searchTerms = (custNo + ' ' + custName + ' ' + String(row[0] || '') + ' ' + String(row[1] || '')).toLowerCase();

      var time = 0;
      if (dateVal instanceof Date) {
        time = dateVal.getTime();
      } else if (typeof dateVal === 'number') {
        time = dateVal;
      }

      list.push({
        id: i,
        date: formatYearMonth(dateVal),
        time: time,
        custNo: String(custNo),
        custName: String(custName),
        customerSearchText: searchTerms,
        product: String(prodVal),
        qty: qtyVal !== '' ? (Number(qtyVal) || qtyVal) : '',
        unit: String(unitVal),
        price: Number(priceVal) || 0
      });
    }

    // เรียงตามวันที่ล่าสุดก่อน
    list.sort(function(a, b) {
      return (b.time || 0) - (a.time || 0);
    });

    // ลบ time เพื่อประหยัดขนาดข้อมูล และรับรองว่าเป็น Primitives 100%
    for (var k = 0; k < list.length; k++) {
      delete list[k].time;
    }

    Logger.log('getAllRefPriceData (' + (isAll ? 'ทุกปี' : targetYear) + '): โหลดได้ ' + list.length + ' รายการ');
    return list;
  } catch(e) {
    Logger.log('getAllRefPriceData error: ' + e);
    return [];
  }
}

// ==========================================
//  ค้นหาข้อมูลดิบจาก Sheet Ref / REF_PRICE / query1
// ==========================================
function getRefData(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. ตรวจสอบ Sheet ชื่อ 'Ref', 'ref', 'REF', 'Sheet Ref', 'query1'
  var names = ['Ref', 'REF', 'ref', 'Sheet Ref', 'REF_PRICE', 'query1', 'Query1'];
  for (var i = 0; i < names.length; i++) {
    try {
      var sh = ss.getSheetByName(names[i]);
      if (sh) {
        var vals = sh.getDataRange().getValues();
        if (vals && vals.length > 1) {
          return vals;
        }
      }
    } catch(e) {}
  }

  // 2. ตรวจสอบ Named Range
  var nrNames = ['REF_PRICE', 'Ref', 'ref', 'query1', 'Query1'];
  for (var i = 0; i < nrNames.length; i++) {
    try {
      var nr = ss.getRangeByName(nrNames[i]);
      if (nr) {
        var vals = nr.getValues();
        if (vals && vals.length > 1) {
          return vals;
        }
      }
    } catch(e) {}
  }

  // 3. วนหา Sheet ใดก็ได้ที่มีคำว่า ref ในชื่อ
  var allSheets = ss.getSheets();
  for (var i = 0; i < allSheets.length; i++) {
    if (/ref/i.test(allSheets[i].getName())) {
      try {
        var vals = allSheets[i].getDataRange().getValues();
        if (vals && vals.length > 1) return vals;
      } catch(e) {}
    }
  }

  return [];
}

// Helper ค้นหาตำแหน่งคอลัมน์จากชื่อหรือ keyword
function findCol_(headers, patterns) {
  if (!headers || !headers.length) return -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim().toLowerCase();
    for (var p = 0; p < patterns.length; p++) {
      if (h === patterns[p] || h.indexOf(patterns[p]) !== -1) return i;
    }
  }
  return -1;
}

// Helper หาชีตลูกค้า (ค้นหาทั้งตามชื่อ และค้นตาม gid 97443798)
function getCustomerSheet_(ss) {
  if (!ss) return null;
  var sh = ss.getSheetByName(SHEET_CUSTOMERS) || 
           ss.getSheetByName('Customer') || 
           ss.getSheetByName('ลูกค้า') || 
           ss.getSheetByName('Customers');
  if (!sh && SHEET_CUSTOMERS_GID) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === SHEET_CUSTOMERS_GID) {
        sh = sheets[i];
        break;
      }
    }
  }
  if (!sh && ss.getSheets().length > 0) {
    sh = ss.getSheets()[0];
  }
  return sh;
}

// ---------- ดึงรายชื่อลูกค้า ----------
function getCustomers(ss) {
  try {
    if (!ss) {
      try {
        ss = SpreadsheetApp.openById(SPREADSHEET_CUSTOMER_ID);
      } catch(e) {
        ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      }
    }
    var sh = getCustomerSheet_(ss);
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    var headers = data[0];
    var colId    = findCol_(headers, ['cust no', 'customer no', 'id', 'รหัส', 'code', 'no']);
    var colTax   = findCol_(headers, ['tax', 'ภาษี']);
    var colName  = findCol_(headers, ['customer', 'name', 'ชื่อ']);
    var colAddr1 = findCol_(headers, ['address_1', 'address1', 'ที่อยู่ 1', 'ที่อยู่1', 'address', 'ที่อยู่']);
    var colAddr2 = findCol_(headers, ['address_2', 'address2', 'ที่อยู่ 2', 'ที่อยู่2']);
    var colPhone = findCol_(headers, ['phone', 'tel', 'เบอร์โทร', 'โทร']);
    var colEmail = findCol_(headers, ['mail', 'email', 'อีเมล']);

    // Fallback ถ้าหัวตารางไม่ตรงตาม pattern ใดเลย
    if (colName === -1) {
      if (headers.length >= 7) {
        colId = 0; colTax = 1; colName = 2; colAddr1 = 3; colAddr2 = 4; colPhone = 5; colEmail = 6;
      } else if (headers.length >= 5) {
        colId = 0; colName = 1; colTax = 2; colAddr1 = 3; colAddr2 = 4;
      } else {
        colName = 0;
      }
    }

    return data.slice(1).map(function(row, i) {
      return {
        id       : i + 2,
        custNo   : colId !== -1 ? String(row[colId] || '').trim() : '',
        taxId    : colTax !== -1 ? String(row[colTax] || '').trim() : '',
        name     : colName !== -1 ? String(row[colName] || '').trim() : '',
        address1 : colAddr1 !== -1 ? String(row[colAddr1] || '').trim() : '',
        address2 : colAddr2 !== -1 ? String(row[colAddr2] || '').trim() : '',
        phone    : colPhone !== -1 ? String(row[colPhone] || '').trim() : '',
        email    : colEmail !== -1 ? String(row[colEmail] || '').trim() : ''
      };
    }).filter(function(c) { return c.name !== ''; });
  } catch (e) {
    Logger.log('getCustomers error: ' + e);
    return [];
  }
}

// ---------- ดึงรายการสินค้าทั้งหมด (สำหรับ DropDown แถวสินค้า) ----------
function getProducts(ss) {
  try {
    if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var refValues = getRefData(ss);

    if (!refValues || refValues.length === 0) return [];

    var seen = {};
    var productList = [];
    var startRow = 0;
    if (refValues.length > 0 && typeof refValues[0][0] === 'string' && /date|วัน|doc|เลข/i.test(refValues[0][0])) {
      startRow = 1;
    }

    for (var i = startRow; i < refValues.length; i++) {
      var row = refValues[i];
      if (!row || row.length < 2) continue;

      var prod = '';
      var price = 0;
      var unit = 'ชิ้น';

      if (row.length >= 7 && row[6] && String(row[6]).trim().length > 0) {
        prod  = String(row[6]).trim();
        price = parsePrice(row[10]);
        unit  = (row[9] !== undefined ? String(row[9]).trim() : '') || 'ชิ้น';
      } else if (row.length >= 2) {
        prod  = String(row[1] || '').trim();
        price = parsePrice(row[4]);
        unit  = (row[3] !== undefined ? String(row[3]).trim() : '') || 'ชิ้น';
      }

      if (!prod || prod === '-' || prod === '#N/A' || prod === '#VALUE!') continue;
      var key = prod.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        productList.push({
          id: i + 1,
          name: prod,
          unit: unit,
          price: price
        });
      }
    }

    productList.sort(function(a, b) { return a.name.localeCompare(b.name, 'th'); });
    return productList;
  } catch (e) {
    Logger.log('getProducts error: ' + e);
    return [];
  }
}

// ---------- เพิ่มลูกค้าใหม่ ----------
function addCustomer(customer) {
  try {
    if (!customer || !customer.name) {
      return { success: false, message: 'กรุณากรอกชื่อลูกค้า' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_CUSTOMER_ID);
    var sh = getCustomerSheet_(ss);
    if (!sh) {
      sh = ss.insertSheet(SHEET_CUSTOMERS);
      sh.appendRow(['ID', 'Name', 'TaxID', 'Address1', 'Address2', 'Telephone Number', 'Mail']);
    }

    var lastCol = Math.max(sh.getLastColumn(), 1);
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    var colId    = findCol_(headers, ['cust no', 'customer no', 'id', 'รหัส', 'code', 'no']);
    var colTax   = findCol_(headers, ['tax', 'ภาษี']);
    var colName  = findCol_(headers, ['customer', 'name', 'ชื่อ']);
    var colAddr1 = findCol_(headers, ['address_1', 'address1', 'ที่อยู่ 1', 'ที่อยู่1', 'address', 'ที่อยู่']);
    var colAddr2 = findCol_(headers, ['address_2', 'address2', 'ที่อยู่ 2', 'ที่อยู่2']);
    var colPhone = findCol_(headers, ['phone', 'tel', 'เบอร์โทร', 'โทร']);
    var colEmail = findCol_(headers, ['mail', 'email', 'อีเมล']);

    // คำนวณรหัสลูกค้าถัดไปอัตโนมัติ (เช่น C0001) ถ้ายังไม่มี
    var custNo = customer.custNo || '';
    if (!custNo && colId !== -1) {
      var lastRow = sh.getLastRow();
      var maxNum = 0;
      if (lastRow > 1) {
        var idVals = sh.getRange(2, colId + 1, lastRow - 1, 1).getValues();
        for (var r = 0; r < idVals.length; r++) {
          var valStr = String(idVals[r][0] || '');
          var num = parseInt(valStr.replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
      if (maxNum > 0) {
        custNo = 'C' + String(maxNum + 1).padStart(4, '0');
      } else if (lastRow > 0) {
        custNo = 'C' + String(lastRow).padStart(4, '0');
      } else {
        custNo = 'C0001';
      }
    }

    if (colName !== -1) {
      var newRow = new Array(headers.length).fill('');
      if (colId !== -1)    newRow[colId]    = custNo;
      if (colName !== -1)  newRow[colName]  = customer.name || '';
      if (colTax !== -1)   newRow[colTax]   = customer.taxId || '';
      if (colAddr1 !== -1) newRow[colAddr1] = customer.address1 || '';
      if (colAddr2 !== -1) newRow[colAddr2] = customer.address2 || '';
      if (colPhone !== -1) newRow[colPhone] = customer.phone || '';
      if (colEmail !== -1) newRow[colEmail] = customer.email || '';
      sh.appendRow(newRow);
    } else {
      sh.appendRow([
        custNo,
        customer.taxId    || '',
        customer.name     || '',
        customer.address1 || '',
        customer.address2 || '',
        customer.phone    || '',
        customer.email    || ''
      ]);
    }

    return { 
      success: true, 
      message: 'เพิ่มลูกค้าเรียบร้อย',
      custNo: custNo 
    };
  } catch (e) {
    Logger.log('addCustomer error: ' + e);
    return { success: false, message: e.toString() };
  }
}

// ---------- บันทึกใบกำกับภาษี (13 รายการ) ----------
function saveInvoice(invoiceData) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(SHEET_ORDERS) || ss.getSheetByName('รายการสั่งซื้อ');
    if (!sh) {
      sh = ss.insertSheet('รายการสั่งซื้อ');
      var headers = [
        'เลขที่', 'วันที่', 'ชื่อลูกค้า', 'Address_1', 'Address_2', 'เลขผู้เสียภาษีลูกค้า'
      ];
      for (var k = 1; k <= 13; k++) {
        headers.push('สินค้า' + k, 'จำนวน' + k, 'หน่วย' + k, 'ราคา/หน่วย' + k, 'รวม' + k);
      }
      headers.push('ราคาก่อน VAT', 'VAT 7%', 'ยอดรวมสุทธิ');
      sh.appendRow(headers);
    }

    var row = [
      invoiceData.invoiceNo || '',
      invoiceData.invoiceDate || '',
      invoiceData.customerName || '',
      invoiceData.customerAddress1 || '',
      invoiceData.customerAddress2 || '',
      invoiceData.customerTaxId || ''
    ];

    for (var i = 0; i < 13; i++) {
      var item = (invoiceData.items && invoiceData.items[i]) || {};
      row.push(item.name||'', item.qty||'', item.unit||'', item.price||'', item.total||'');
    }

    row.push(invoiceData.subtotal||0, invoiceData.vat||0, invoiceData.grandTotal||0);
    sh.appendRow(row);

    // หยอดข้อมูลลงใน Sheet "Print" ตามพิกัดเซลล์จริงของผู้ใช้
    try {
      writeToPrintSheetExact(ss, invoiceData);
    } catch(errPrint) {
      Logger.log('writeToPrintSheetExact warning: ' + errPrint);
    }

    return { success: true, message: 'บันทึกใบกำกับภาษีเรียบร้อย' };
  } catch (e) {
    Logger.log('saveInvoice error: ' + e);
    return { success: false, message: e.toString() };
  }
}

// ==========================================
//  หยอดข้อมูลลง Sheet "Print" ตามพิกัดเซลล์จริงของผู้ใช้
// ==========================================
function writeToPrintSheetExact(ss, data) {
  var printSheet = ss.getSheetByName('Print') || ss.getSheetByName('print') || ss.getSheetByName('พิมพ์');
  if (!printSheet) return;

  function formatD(dStr) {
    if (!dStr) return '';
    var parts = String(dStr).split('-');
    if (parts.length === 3) {
      return parseInt(parts[2], 10) + '/' + parts[1] + '/' + parts[0];
    }
    return String(dStr);
  }

  // 1. ข้อมูลลูกค้า & เอกสาร (แถว 13 - 17)
  printSheet.getRange('B13').setValue(data.customerName || '');      // ชื่อลูกค้า B13:G13
  printSheet.getRange('B14').setValue(data.customerAddress1 || '');  // ที่อยู่ 1 B14:F14
  printSheet.getRange('H14').setValue(formatD(data.invoiceDate));    // วันที่ H14:I14
  printSheet.getRange('B15').setValue(data.customerAddress2 || '');  // ที่อยู่ 2 B15:F15
  printSheet.getRange('D17').setValue(data.customerTaxId || '');     // เลขประจำตัวผู้เสียภาษี D17:F17
  printSheet.getRange('H17').setValue(data.invoiceNo || '');         // เลขที่เอกสาร H17:I17

  // 2. ตารางรายการสินค้า 13 แถว (แถว 19 - 31)
  var items = data.items || [];
  for (var i = 0; i < 13; i++) {
    var r = 19 + i; // แถว 19 ถึง 31
    var item = items[i] || null;

    if (item && item.name) {
      printSheet.getRange('A' + r).setValue(i + 1);             // ลำดับ
      printSheet.getRange('B' + r).setValue(item.name);         // รายการสินค้า B-D
      printSheet.getRange('E' + r).setValue(item.qty || '');    // จำนวน
      printSheet.getRange('F' + r).setValue(item.unit || '');   // หน่วยนับ
      printSheet.getRange('G' + r).setValue(item.price || '');  // ราคาต่อหน่วย
      if (!printSheet.getRange('H' + r).getFormula()) {
        printSheet.getRange('H' + r).setValue(item.total || '');
      }
    } else {
      // เคลียร์แถวว่าง
      printSheet.getRange('A' + r).setValue('');
      printSheet.getRange('B' + r).setValue('');
      printSheet.getRange('E' + r).setValue('');
      printSheet.getRange('F' + r).setValue('');
      printSheet.getRange('G' + r).setValue('');
      if (!printSheet.getRange('H' + r).getFormula()) {
        printSheet.getRange('H' + r).setValue('');
      }
    }
  }

  // เคลียร์แถว 32 (หากเคยมีข้อมูล 14 รายการค้างไว้)
  printSheet.getRange('A32:G32').setValue('');

  // 3. สรุปยอดเงิน (แถว 34 - 36) — เติมค่าถ้าไม่มีสูตร
  if (!printSheet.getRange('H34').getFormula()) {
    printSheet.getRange('H34').setValue(data.subtotal || 0);
  }
  if (!printSheet.getRange('H35').getFormula()) {
    printSheet.getRange('H35').setValue(data.vat || 0);
  }
  if (!printSheet.getRange('H36').getFormula()) {
    printSheet.getRange('H36').setValue(data.grandTotal || 0);
  }
  if (!printSheet.getRange('B36').getFormula()) {
    try {
      printSheet.getRange('B36').setFormula('=BAHTTEXT(H36)');
    } catch(eFormula) {}
  }

  SpreadsheetApp.flush();
}
