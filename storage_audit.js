/**
 * storage_audit.js
 * Utilitas CLI Audit Penyimpanan Sistem (Zero-Dependency)
 * Menggunakan modul native Node.js: fs, path, crypto, readline.
 *
 * Persyaratan:
 * STG-01: Recursive Scan (pemindaian mendalam target folder & subfolder)
 * STG-02: Duplicate Detection (SHA-256 identik dengan pemilihan file master aman)
 * STG-03: Giant File Flagging (ambang batas >= 2 MB / 2.048 KB)
 * STG-04: Terminal Report (output teks terstruktur & informatif)
 * STG-05: Safe Cleanup Confirmation (prompt interaktif Y/N, hanya hapus duplikat & .tmp)
 * STG-06: Zero-Dependency Portability (berjalan langsung dengan runtime Node.js bawaan)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Ambang batas ukuran file raksasa: 2 MB (2.048 KB = 2 * 1024 * 1024 bytes)
const GIANT_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024;

// Nama file skrip sendiri agar diabaikan saat pemindaian
const SELF_SCRIPTS = new Set(['storage_audit.js', 'storage_audit.py']);

// Format utilitas angka byte ke string representatif
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Menghitung hash SHA-256 dari sebuah file secara efisien
function calculateSHA256(filePath) {
  try {
    const hash = crypto.createHash('sha256');
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest('hex');
  } catch (err) {
    console.error(`[WARN] Gagal membaca hash untuk file: ${filePath} (${err.message})`);
    return null;
  }
}

// STG-01: Pemindaian Rekursif Mendalam
function scanDirectoryRecursively(dirPath, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`[WARN] Gagal membaca direktori: ${dirPath} (${err.message})`);
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Abaikan folder kontrol versi jika ada
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      scanDirectoryRecursively(fullPath, fileList);
    } else if (entry.isFile()) {
      // Abaikan skrip audit itu sendiri
      if (SELF_SCRIPTS.has(entry.name.toLowerCase())) continue;

      try {
        const stats = fs.statSync(fullPath);
        fileList.push({
          name: entry.name,
          fullPath: fullPath,
          relativePath: path.relative(process.cwd(), fullPath),
          sizeBytes: stats.size,
          isTmp: entry.name.toLowerCase().endsWith('.tmp'),
          hash: null // Diisi saat tahap hashing
        });
      } catch (err) {
        console.error(`[WARN] Gagal membaca stat file: ${fullPath} (${err.message})`);
      }
    }
  }

  return fileList;
}

// Skoring untuk menentukan file asli (original) dalam grup duplikat
// Penalti lebih rendah = lebih diprioritaskan sebagai file ASLI yang dipertahankan
function getOriginalScore(fileName) {
  let penalty = 0;
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.tmp')) penalty += 500;
  if (lower.includes(' - copy') || lower.includes(' - salinan')) penalty += 100;
  if (/\(\d+\)/.test(lower)) penalty += 100;
  if (lower.includes('_copy') || lower.includes('_backup')) penalty += 80;
  if (lower.includes('_final')) penalty += 60;
  if (/_v\d+/.test(lower)) penalty += 50;
  if (lower.includes('_edit')) penalty += 50;
  if (lower.includes('_fix')) penalty += 40;

  // Nama lebih pendek lebih disukai sebagai file master
  return penalty * 10000 + fileName.length;
}

// Prompt konfirmasi interaktif STG-05
function askConfirmation(promptQuestion) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(promptQuestion, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Fungsi Utama CLI Audit
async function main() {
  const args = process.argv.slice(2);
  const isAutoYes = args.includes('-y') || args.includes('--yes');
  const pathArgs = args.filter(a => !a.startsWith('-'));

  // Penentuan target folder pemindaian
  let targetFolder;
  if (pathArgs.length > 0) {
    targetFolder = path.resolve(process.cwd(), pathArgs[0]);
  } else {
    // Cek keberadaan folder eksplisit 'Bahan Latihan P12' di lokasi sekitar
    const candidateLocal = path.join(process.cwd(), 'Bahan Latihan P12');
    const candidateParent = path.join(process.cwd(), '..', 'Bahan Latihan P12');

    if (fs.existsSync(candidateLocal) && fs.statSync(candidateLocal).isDirectory()) {
      targetFolder = candidateLocal;
    } else if (fs.existsSync(candidateParent) && fs.statSync(candidateParent).isDirectory()) {
      targetFolder = candidateParent;
    } else {
      targetFolder = process.cwd();
    }
  }

  if (!fs.existsSync(targetFolder) || !fs.statSync(targetFolder).isDirectory()) {
    console.error(`\x1b[31m[ERROR] Folder target tidak ditemukan: ${targetFolder}\x1b[0m`);
    process.exit(1);
  }

  console.log('='.repeat(78));
  console.log('         STORAGE AUDIT CLI - SISTEM AUDIT & OPTIMASI PENYIMPANAN      ');
  console.log('='.repeat(78));
  console.log(`Target Folder : ${targetFolder}`);
  console.log(`Waktu Audit   : ${new Date().toLocaleString('id-ID')}`);
  console.log(`Runtime       : Node.js ${process.version} (Native Modules: fs, path, crypto, readline)`);
  console.log('-'.repeat(78));

  // STG-01: Recursive Scan
  process.stdout.write('[STG-01] Memindai seluruh folder secara rekursif...');
  const files = scanDirectoryRecursively(targetFolder);
  console.log(` Selesai!`);
  console.log(`         Total file terdeteksi: ${files.length} file.`);

  // Hitung Hash SHA-256 dan total ukuran
  process.stdout.write('[STG-01] Menghitung checksum SHA-256 untuk setiap file...');
  let totalSizeBytes = 0;
  for (const file of files) {
    file.hash = calculateSHA256(file.fullPath);
    totalSizeBytes += file.sizeBytes;
  }
  console.log(` Selesai!\n`);

  // STG-03: Giant File Flagging (>= 2 MB / 2.048 KB)
  const giantFiles = files
    .filter(f => f.sizeBytes >= GIANT_FILE_THRESHOLD_BYTES)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  // STG-02: Duplicate Detection
  const hashMap = new Map();
  for (const file of files) {
    if (!file.hash) continue;
    if (!hashMap.has(file.hash)) {
      hashMap.set(file.hash, []);
    }
    hashMap.get(file.hash).push(file);
  }

  const duplicateGroups = [];
  let totalRedundantCopies = 0;
  let totalSavingsBytes = 0;

  for (const [hash, group] of hashMap.entries()) {
    if (group.length > 1) {
      // Urutkan grup untuk memilih file master/asli terbaik
      group.sort((a, b) => {
        const scoreA = getOriginalScore(a.name);
        const scoreB = getOriginalScore(b.name);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.name.localeCompare(b.name);
      });

      const masterFile = group[0];
      const redundantCopies = group.slice(1);
      const groupSavings = redundantCopies.reduce((acc, f) => acc + f.sizeBytes, 0);

      duplicateGroups.push({
        hash,
        master: masterFile,
        duplicates: redundantCopies,
        fileSize: masterFile.sizeBytes,
        savingsBytes: groupSavings,
        totalFilesInGroup: group.length
      });

      totalRedundantCopies += redundantCopies.length;
      totalSavingsBytes += groupSavings;
    }
  }

  // Deteksi file .tmp sampah tambahan (di luar salinan duplikat yang sudah dihitung)
  const tmpFiles = files.filter(f => {
    if (!f.isTmp) return false;
    // Cek apakah file tmp ini sudah masuk daftar salinan duplikat
    const isAlreadyMarkedDuplicate = duplicateGroups.some(g =>
      g.duplicates.some(d => d.fullPath === f.fullPath)
    );
    return !isAlreadyMarkedDuplicate;
  });

  const tmpFilesSavingsBytes = tmpFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
  const totalCombinedSavingsBytes = totalSavingsBytes + tmpFilesSavingsBytes;

  // STG-04: Terminal Report
  // 1. Tampilkan File Raksasa (STG-03)
  console.log('='.repeat(78));
  console.log(`[STG-03] DAFTAR FILE RAKSASA (Ambang Batas: >= 2 MB / 2.048 KB)`);
  console.log(`Ditemukan: ${giantFiles.length} file raksasa`);
  console.log('-'.repeat(78));
  console.log(
    ` No | ${'Nama File'.padEnd(42)} | ${'Ukuran (MB)'.padStart(12)} | ${'Ukuran (KB)'.padStart(14)}`
  );
  console.log('-'.repeat(78));

  giantFiles.forEach((file, index) => {
    const noStr = String(index + 1).padStart(3);
    const nameStr =
      file.name.length > 42 ? file.name.substring(0, 39) + '...' : file.name.padEnd(42);
    const mbStr = formatMB(file.sizeBytes).padStart(12);
    const kbStr = formatKB(file.sizeBytes).padStart(14);
    console.log(`${noStr} | ${nameStr} | ${mbStr} | ${kbStr}`);
  });
  console.log('-'.repeat(78));
  console.log();

  // 2. Tampilkan Kelompok Duplikat (STG-02)
  console.log('='.repeat(78));
  console.log(`[STG-02] DAFTAR KELOMPOK DUPLIKAT (Berdasarkan SHA-256 Identik)`);
  console.log(`Ditemukan: ${duplicateGroups.length} kelompok duplikat (${totalRedundantCopies} salinan tidak terpakai)`);
  console.log(`Potensi Hemat Ruang Duplikat: ${formatMB(totalSavingsBytes)} (${formatKB(totalSavingsBytes)})`);
  console.log('-'.repeat(78));

  duplicateGroups.forEach((group, index) => {
    console.log(
      `[Kelompok ${String(index + 1).padStart(2)}] Hash: ${group.hash.substring(0, 16)}... | Ukuran/file: ${formatKB(group.fileSize)} (${group.fileSize.toLocaleString()} bytes)`
    );
    console.log(`  [ASLI (DIPERTAHANKAN)] : ${group.master.name}`);
    group.duplicates.forEach(dup => {
      console.log(`  [SALINAN (DUPLIKAT)]   : ${dup.name}`);
    });
    console.log();
  });

  // Tampilkan file .tmp jika ditemukan
  if (tmpFiles.length > 0) {
    console.log('-'.repeat(78));
    console.log(`[FILE SAMPAH .TMP DITEMUKAN: ${tmpFiles.length} file]`);
    tmpFiles.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${f.name} (${formatBytes(f.sizeBytes)})`);
    });
    console.log();
  }

  // 3. Ringkasan Laporan Terminal (STG-04)
  console.log('='.repeat(78));
  console.log('                         RINGKASAN AUDIT PENYIMPANAN                          ');
  console.log('='.repeat(78));
  console.log(`Total File Dipindai            : ${files.length} file`);
  console.log(`Total Ukuran Folder Target     : ${formatMB(totalSizeBytes)} (${formatKB(totalSizeBytes)} / ${totalSizeBytes.toLocaleString()} bytes)`);
  console.log(`Jumlah File Raksasa (>= 2 MB)  : ${giantFiles.length} file`);
  console.log(`Jumlah Kelompok Duplikat       : ${duplicateGroups.length} kelompok`);
  console.log(`Jumlah Salinan Duplikat        : ${totalRedundantCopies} salinan`);
  console.log(`Jumlah File Sampah (.tmp)      : ${tmpFiles.length} file`);
  console.log(`Estimasi Hemat Ruang Bersih    : ${formatMB(totalCombinedSavingsBytes)} (${formatKB(totalCombinedSavingsBytes)} / ${totalCombinedSavingsBytes.toLocaleString()} bytes)`);
  console.log('='.repeat(78));
  console.log();

  // STG-05: Safe Cleanup Confirmation
  const filesToDelete = [];
  for (const group of duplicateGroups) {
    for (const dup of group.duplicates) {
      filesToDelete.push(dup);
    }
  }
  for (const tmp of tmpFiles) {
    filesToDelete.push(tmp);
  }

  if (filesToDelete.length === 0) {
    console.log('\x1b[32m[INFO] Tidak ada file duplikat atau file sampah .tmp yang perlu dibersihkan.\x1b[0m');
    return;
  }

  let answer;
  if (isAutoYes) {
    console.log('[AUTO-YES] Menjalankan pembersihan otomatis dengan flag -y.');
    answer = 'Y';
  } else {
    answer = await askConfirmation(
      'Apakah kamu ingin menghapus file duplikat yang tidak terpakai? (Y/N): '
    );
  }

  const normalizedAnswer = answer.trim().toUpperCase();

  if (normalizedAnswer === 'Y' || normalizedAnswer === 'YES') {
    console.log('\n[CLEANUP] Memulai proses pembersihan aman...');
    let deletedCount = 0;
    let freedBytes = 0;
    let failedCount = 0;

    for (const item of filesToDelete) {
      try {
        fs.unlinkSync(item.fullPath);
        deletedCount++;
        freedBytes += item.sizeBytes;
        console.log(`  \x1b[32m[DIHAPUS]\x1b[0m ${item.name} (${formatBytes(item.sizeBytes)})`);
      } catch (err) {
        failedCount++;
        console.error(`  \x1b[31m[GAGAL]\x1b[0m ${item.name}: ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(78));
    console.log('                       HASIL PEMBERSIHAN PENYIMPANAN                          ');
    console.log('='.repeat(78));
    console.log(`File Berhasil Dihapus          : ${deletedCount} file`);
    if (failedCount > 0) {
      console.log(`File Gagal Dihapus             : ${failedCount} file`);
    }
    console.log(`Total Ruang Berhasil Dibebaskan: ${formatMB(freedBytes)} (${formatKB(freedBytes)} / ${freedBytes.toLocaleString()} bytes)`);
    console.log(`Keamanan Data                  : 1 file asli per kelompok duplikat tetap dipertahankan.`);
    console.log('='.repeat(78));
  } else {
    console.log('\n\x1b[33m[BATAL] Pembersihan dibatalkan oleh pengguna (N).\x1b[0m');
    console.log('Seluruh file duplikat dan file asli tetap utuh dan aman.');
  }
}

// Jalankan skrip CLI
main().catch(err => {
  console.error('\x1b[31m[FATAL ERROR]\x1b[0m', err);
  process.exit(1);
});
