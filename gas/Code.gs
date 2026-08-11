/**
 * Yusuke & Aika Wedding Invitation Backend
 *
 * GitHub PagesからJSONPで呼び出すGoogle Apps Scriptです。
 * スプレッドシート列：
 * A URL / B ゲスト名 / C メールアドレス / D 挙式出欠 / E 披露宴出欠 / F アレルギー
 * G 回答日時 / H 確認メール送信日時 / I 1週間前リマインド送信日時
 * J 前日リマインド送信日時 / K 更新日時 / L 招待状URL
 * M メッセージ / N 参加ありがとうメール送信日時
 */

const APP_CONFIG = {
  spreadsheetId: '1micDJFsf6ktwZrq_tlIz9TiC4PjbBbv-7dlWgbhMjbs',
  sheetName: 'ゲスト一覧',
  timeZone: 'Asia/Tokyo',
  weddingDateYmd: '2027-03-21',
  weddingDateIso: '2027-03-21T10:00:00+09:00',
  receptionEndIso: '2027-03-21T14:00:00+09:00',
  weddingDateLabel: '2027年3月21日（日）',
  ceremonyTimeLabel: '10:00〜10:30',
  receptionTimeLabel: '11:00〜14:00',
  groomFullName: '白戸祐輔',
  brideFullName: '大貫愛佳',
  senderName: 'Yusuke & Aika Wedding',
  venueName: 'キンプトン新宿東京',
  venueUrl: 'https://www.kimptonshinjukuwedding.com/',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=%E3%82%AD%E3%83%B3%E3%83%97%E3%83%88%E3%83%B3%E6%96%B0%E5%AE%BF%E6%9D%B1%E4%BA%AC',
  baseInvitationUrl: 'https://Yusuke-Aika-Wedding.github.io/invitation-test3/',
  reminderHour: 9,
  thanksHour: 15
};

const HEADERS = [
  'URL',
  'ゲスト名',
  'メールアドレス',
  '挙式出欠',
  '披露宴出欠',
  'アレルギー',
  '回答日時',
  '確認メール送信日時',
  '1週間前リマインド送信日時',
  '前日リマインド送信日時',
  '更新日時',
  '招待状URL',
  'メッセージ',
  '参加ありがとうメール送信日時'
];

const COL = {
  url: 1,
  name: 2,
  email: 3,
  ceremony: 4,
  reception: 5,
  allergy: 6,
  submittedAt: 7,
  confirmationSentAt: 8,
  reminder7SentAt: 9,
  reminder1SentAt: 10,
  updatedAt: 11,
  invitationUrl: 12,
  message: 13,
  thanksSentAt: 14
};

function setup() {
  const sheet = getMainSheet_();
  ensureHeaders_(sheet);
  fillInvitationUrls_(sheet);
  formatSheet_(sheet);
  resetTriggers_();
  SpreadsheetApp.flush();
  Logger.log('Setup complete. Webアプリとしてデプロイし、URLをGitHub側の js/config.js に貼り付けてください。');
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  try {
    const action = params.action || 'status';
    if (action === 'ping') return output_({ ok: true, message: 'pong' }, params.callback);
    if (action === 'status') return output_(getStatus_(params.guestId), params.callback);
    if (action === 'submit') return output_(submitResponse_(params), params.callback);
    if (action === 'fillUrls') return output_({ ok: true, updated: fillInvitationUrls_(getMainSheet_()) }, params.callback);
    if (action === 'sendThanksNow') return output_({ ok: true, sent: sendAfterReceptionThanksEmails_(true) }, params.callback);
    return output_({ ok: false, error: 'Unknown action.' }, params.callback);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({ ok: false, error: error.message || String(error) }, params.callback);
  }
}

function doPost(e) {
  try {
    const params = parsePostParams_(e);
    return output_(submitResponse_(params));
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({ ok: false, error: error.message || String(error) });
  }
}

function getStatus_(guestIdRaw) {
  const guestId = normalizeGuestId_(guestIdRaw);
  if (!guestId) throw new Error('guestIdがありません。');

  const sheet = getMainSheet_();
  ensureHeaders_(sheet);
  const record = findGuestRecord_(sheet, guestId);
  if (!record) throw new Error('ゲスト情報が見つかりません。');

  const values = record.values;
  const completed = isCompleted_(values);
  return {
    ok: true,
    guestId: values.url,
    displayName: values.name || 'ゲスト',
    completed: completed,
    attending: isAttending_(values.ceremony, values.reception),
    email: values.email || '',
    ceremonyAttendance: values.ceremony || '',
    receptionAttendance: values.reception || '',
    allergy: values.allergy || '',
    message: values.message || '',
    submittedAt: values.submittedAt ? formatDateTime_(values.submittedAt) : ''
  };
}

function submitResponse_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const guestId = normalizeGuestId_(params.guestId);
    const email = String(params.email || '').trim();
    const ceremonyAttendance = normalizeAttendance_(params.ceremonyAttendance);
    const receptionAttendance = normalizeAttendance_(params.receptionAttendance);
    const allergyChoice = String(params.allergyChoice || '').trim();
    const allergyDetails = String(params.allergyDetails || '').trim();
    const message = String(params.message || '').trim();

    if (!guestId) throw new Error('guestIdがありません。');
    if (!isValidEmail_(email)) throw new Error('メールアドレスを確認してください。');
    if (!ceremonyAttendance) throw new Error('挙式の出欠を選択してください。');
    if (!receptionAttendance) throw new Error('披露宴の出欠を選択してください。');

    let allergy = '';
    if (allergyChoice === 'なし') {
      allergy = 'なし';
    } else if (allergyChoice === 'あり') {
      if (!allergyDetails) throw new Error('アレルギーの詳細を入力してください。');
      allergy = allergyDetails;
    } else {
      throw new Error('アレルギーの「あり」「なし」を選択してください。');
    }

    const sheet = getMainSheet_();
    ensureHeaders_(sheet);
    const record = findGuestRecord_(sheet, guestId);
    if (!record) throw new Error('ゲスト情報が見つかりません。');
    const name = record.values.name || 'ゲスト';

    const now = new Date();
    const invitationUrl = getInvitationUrl_();
    sheet.getRange(record.rowNumber, 1, 1, HEADERS.length).setValues([[
      guestId,
      name,
      email,
      ceremonyAttendance,
      receptionAttendance,
      allergy,
      now,
      record.values.confirmationSentAt || '',
      record.values.reminder7SentAt || '',
      record.values.reminder1SentAt || '',
      now,
      invitationUrl,
      message,
      record.values.thanksSentAt || ''
    ]]);

    sendConfirmationEmail_({
      to: email,
      name: name,
      ceremonyAttendance: ceremonyAttendance,
      receptionAttendance: receptionAttendance,
      allergy: allergy,
      message: message,
      invitationUrl: invitationUrl
    });

    const afterMail = new Date();
    sheet.getRange(record.rowNumber, COL.confirmationSentAt).setValue(afterMail);
    sheet.getRange(record.rowNumber, COL.updatedAt).setValue(afterMail);

    return {
      ok: true,
      completed: true,
      attending: isAttending_(ceremonyAttendance, receptionAttendance),
      displayName: name
    };
  } finally {
    lock.releaseLock();
  }
}

function sendReminderEmails() {
  const daysBefore = daysBeforeWedding_(new Date());
  if (![7, 1].includes(daysBefore)) {
    Logger.log(`Reminder skipped. daysBefore=${daysBefore}`);
    return;
  }
  sendReminderEmailsByDays_(daysBefore, false);
}

function testReminder7Days() {
  sendReminderEmailsByDays_(7, true);
}

function testReminder1Day() {
  sendReminderEmailsByDays_(1, true);
}

function sendReminderEmailsByDays_(daysBefore, isTest) {
  const sheet = getMainSheet_();
  ensureHeaders_(sheet);
  const records = readRecords_(sheet);
  const sentColumn = daysBefore === 7 ? COL.reminder7SentAt : COL.reminder1SentAt;
  const sentKey = daysBefore === 7 ? 'reminder7SentAt' : 'reminder1SentAt';
  let sentCount = 0;

  records.forEach(record => {
    const v = record.values;
    if (!isCompleted_(v)) return;
    if (!isValidEmail_(v.email)) return;
    if (!isAttending_(v.ceremony, v.reception)) return;
    if (!isTest && v[sentKey]) return;

    sendReminderEmail_({
      to: v.email,
      name: v.name || 'ゲスト',
      ceremonyAttendance: v.ceremony,
      receptionAttendance: v.reception,
      allergy: v.allergy || '',
      daysBefore: daysBefore,
      invitationUrl: v.invitationUrl || getInvitationUrl_()
    });

    if (!isTest) {
      const now = new Date();
      sheet.getRange(record.rowNumber, sentColumn).setValue(now);
      sheet.getRange(record.rowNumber, COL.updatedAt).setValue(now);
    }
    sentCount++;
  });

  Logger.log(`${daysBefore}日前リマインド送信数: ${sentCount}`);
  return sentCount;
}

function sendAfterReceptionThanksEmails() {
  return sendAfterReceptionThanksEmails_(false);
}

function testAfterReceptionThanksEmails() {
  return sendAfterReceptionThanksEmails_(true);
}

function sendAfterReceptionThanksEmails_(isTest) {
  const now = new Date();
  if (!isTest && now.getTime() < new Date(APP_CONFIG.receptionEndIso).getTime()) {
    Logger.log('Thanks mail skipped. Reception has not ended yet.');
    return 0;
  }

  const sheet = getMainSheet_();
  ensureHeaders_(sheet);
  const records = readRecords_(sheet);
  let sentCount = 0;

  records.forEach(record => {
    const v = record.values;
    if (!isCompleted_(v)) return;
    if (!isValidEmail_(v.email)) return;
    if (!isAttending_(v.ceremony, v.reception)) return;
    if (!isTest && v.thanksSentAt) return;

    sendAfterReceptionThanksEmail_({
      to: v.email,
      name: v.name || 'ゲスト',
      invitationUrl: v.invitationUrl || getInvitationUrl_()
    });

    if (!isTest) {
      const sentAt = new Date();
      sheet.getRange(record.rowNumber, COL.thanksSentAt).setValue(sentAt);
      sheet.getRange(record.rowNumber, COL.updatedAt).setValue(sentAt);
    }
    sentCount++;
  });

  Logger.log(`参加ありがとうメール送信数: ${sentCount}`);
  return sentCount;
}

function sendConfirmationEmail_(data) {
  const subject = '【ご回答確認】Yusuke & Aika Wedding Invitation';
  const textBody = buildConfirmationText_(data);
  const htmlBody = buildHtmlMail_(subject, textBody, data.invitationUrl);
  MailApp.sendEmail({
    to: data.to,
    subject: subject,
    name: APP_CONFIG.senderName,
    body: textBody,
    htmlBody: htmlBody
  });
}

function sendReminderEmail_(data) {
  const subject = data.daysBefore === 7
    ? '【1週間前リマインド】Yusuke & Aika Wedding'
    : '【前日リマインド】Yusuke & Aika Wedding';
  const textBody = buildReminderText_(data);
  const htmlBody = buildHtmlMail_(subject, textBody, data.invitationUrl);
  MailApp.sendEmail({
    to: data.to,
    subject: subject,
    name: APP_CONFIG.senderName,
    body: textBody,
    htmlBody: htmlBody
  });
}

function sendAfterReceptionThanksEmail_(data) {
  const subject = '【御礼】本日はありがとうございました';
  const textBody = buildAfterReceptionThanksText_(data);
  const htmlBody = buildHtmlMail_(subject, textBody, data.invitationUrl);
  MailApp.sendEmail({
    to: data.to,
    subject: subject,
    name: APP_CONFIG.senderName,
    body: textBody,
    htmlBody: htmlBody
  });
}

function buildConfirmationText_(data) {
  const messageLine = data.message ? `\n【メッセージ】\n${data.message}\n` : '';
  return `${data.name} 様\n\n結婚式へのご出欠について、ご回答いただき誠にありがとうございます。\n以下の内容で承りました。\n\n【挙式】${data.ceremonyAttendance}\n【披露宴】${data.receptionAttendance}\n【アレルギー】${data.allergy || 'なし'}${messageLine}\n【日時】${APP_CONFIG.weddingDateLabel}\n挙式 ${APP_CONFIG.ceremonyTimeLabel}\n披露宴 ${APP_CONFIG.receptionTimeLabel}\n\n【会場】${APP_CONFIG.venueName}\n${APP_CONFIG.venueUrl}\nGoogle Map：${APP_CONFIG.mapUrl}\n\n招待状URL：\n${data.invitationUrl}\n\n当日お会いできますことを、心より楽しみにしております。\n\nYusuke & Aika`;
}

function buildReminderText_(data) {
  const timing = data.daysBefore === 7 ? '1週間前' : '前日';
  return `${data.name} 様\n\n結婚式${timing}のリマインドです。\n当日はお気をつけてお越しください。\n\n【日時】${APP_CONFIG.weddingDateLabel}\n挙式 ${APP_CONFIG.ceremonyTimeLabel}\n披露宴 ${APP_CONFIG.receptionTimeLabel}\n\n【会場】${APP_CONFIG.venueName}\n${APP_CONFIG.venueUrl}\nGoogle Map：${APP_CONFIG.mapUrl}\n\n【ご回答内容】\n挙式：${data.ceremonyAttendance}\n披露宴：${data.receptionAttendance}\nアレルギー：${data.allergy || 'なし'}\n\n招待状URL：\n${data.invitationUrl}\n\n皆様と当日お会いできますことを、心より楽しみにしております。\n\nYusuke & Aika`;
}

function buildAfterReceptionThanksText_(data) {
  return `${data.name} 様\n\n本日は私たちの結婚式にご参加いただき、誠にありがとうございました。\n皆様と大切な時間を過ごすことができ、心より感謝しております。\n\n招待状URL：\n${data.invitationUrl}\n\n本当の最後の謎ページは、披露宴終了後からご覧いただけます。\n\n今後ともどうぞよろしくお願いいたします。\n\nYusuke & Aika`;
}

function buildHtmlMail_(title, textBody, invitationUrl) {
  const escaped = escapeHtml_(textBody).replace(/\n/g, '<br>');
  return `
    <div style="margin:0;padding:28px;background:#fff8f3;color:#392724;font-family:serif;line-height:1.8;">
      <div style="max-width:640px;margin:auto;padding:28px;border:1px solid #e3c7af;border-radius:24px;background:#fffdfb;">
        <h1 style="margin:0 0 18px;color:#7a1d33;font-size:24px;">${escapeHtml_(title)}</h1>
        <p style="margin:0;">${escaped}</p>
        <p style="margin:24px 0 0;"><a href="${escapeHtml_(invitationUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#7a1d33;color:#fff;text-decoration:none;">招待状を開く</a></p>
      </div>
    </div>`;
}

function resetTriggers_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const handler = trigger.getHandlerFunction();
    if (handler === 'sendReminderEmails' || handler === 'sendAfterReceptionThanksEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('sendReminderEmails')
    .timeBased()
    .everyDays(1)
    .atHour(APP_CONFIG.reminderHour)
    .create();
  ScriptApp.newTrigger('sendAfterReceptionThanksEmails')
    .timeBased()
    .everyDays(1)
    .atHour(APP_CONFIG.thanksHour)
    .create();
}

function fillInvitationUrls_(sheet) {
  sheet = sheet || getMainSheet_();
  ensureHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const tokens = sheet.getRange(2, COL.url, lastRow - 1, 1).getValues();
  const urls = tokens.map(row => [row[0] ? getInvitationUrl_() : '']);
  sheet.getRange(2, COL.invitationUrl, urls.length, 1).setValues(urls);
  return urls.filter(row => row[0]).length;
}

function getMainSheet_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
  return APP_CONFIG.sheetName ? ss.getSheetByName(APP_CONFIG.sheetName) : ss.getSheets()[0];
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsUpdate = HEADERS.some((header, index) => String(current[index] || '') !== header);
  if (needsUpdate) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function formatSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#f8e9df');
  sheet.autoResizeColumns(1, HEADERS.length);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), HEADERS.length).setVerticalAlignment('middle');
}

function readRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return rows.map((row, index) => ({ rowNumber: index + 2, values: rowToObject_(row) })).filter(record => record.values.url);
}

function findGuestRecord_(sheet, guestId) {
  const target = normalizeGuestId_(guestId);
  return readRecords_(sheet).find(record => normalizeGuestId_(record.values.url) === target) || null;
}

function rowToObject_(row) {
  return {
    url: String(row[COL.url - 1] || '').trim(),
    name: String(row[COL.name - 1] || '').trim(),
    email: String(row[COL.email - 1] || '').trim(),
    ceremony: String(row[COL.ceremony - 1] || '').trim(),
    reception: String(row[COL.reception - 1] || '').trim(),
    allergy: String(row[COL.allergy - 1] || '').trim(),
    submittedAt: row[COL.submittedAt - 1],
    confirmationSentAt: row[COL.confirmationSentAt - 1],
    reminder7SentAt: row[COL.reminder7SentAt - 1],
    reminder1SentAt: row[COL.reminder1SentAt - 1],
    updatedAt: row[COL.updatedAt - 1],
    invitationUrl: String(row[COL.invitationUrl - 1] || '').trim(),
    message: String(row[COL.message - 1] || '').trim(),
    thanksSentAt: row[COL.thanksSentAt - 1]
  };
}

function isCompleted_(values) {
  return Boolean(normalizeAttendance_(values.ceremony) && normalizeAttendance_(values.reception));
}

function isAttending_(ceremony, reception) {
  return normalizeAttendance_(ceremony) === '出席' || normalizeAttendance_(reception) === '出席';
}

function normalizeAttendance_(value) {
  const v = String(value || '').trim();
  if (['出席', '参加', 'attend', 'yes', '参加する'].includes(v)) return '出席';
  if (['欠席', '不参加', 'decline', 'no', '参加しない'].includes(v)) return '欠席';
  return '';
}

function normalizeGuestId_(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function getInvitationUrl_() {
  return APP_CONFIG.baseInvitationUrl.replace(/\/?$/, '/');
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function formatDateTime_(date) {
  return Utilities.formatDate(new Date(date), APP_CONFIG.timeZone, 'yyyy/MM/dd HH:mm:ss');
}

function daysBeforeWedding_(date) {
  const today = dateOnly_(date);
  const wedding = dateOnly_(new Date(APP_CONFIG.weddingDateIso));
  return Math.round((wedding.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function dateOnly_(date) {
  const y = Utilities.formatDate(new Date(date), APP_CONFIG.timeZone, 'yyyy');
  const m = Utilities.formatDate(new Date(date), APP_CONFIG.timeZone, 'MM');
  const d = Utilities.formatDate(new Date(date), APP_CONFIG.timeZone, 'dd');
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}

function parsePostParams_(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    const type = e.postData.type || '';
    if (type.includes('application/json')) return JSON.parse(e.postData.contents);
  }
  return (e.parameter || {});
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    const safeCallback = String(callback).replace(/[^\w.$]/g, '');
    return ContentService.createTextOutput(`${safeCallback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
