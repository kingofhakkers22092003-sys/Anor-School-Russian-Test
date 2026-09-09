/* Chinese dashboarddagi yakuniy Telegram oqimini Russian testiga moslashtirish. */
(() => {
  const finished = student => TEST_ORDER.every(test => student?.results?.[test.key] && !student.results[test.key].pending);
  const saveStudent = update => {
    const students = getStudents(); const index = students.findIndex(student => student.id === update.id);
    if (index === -1) return;
    students[index] = update; saveStudents(students);
    const current = currentStudent(); if (current?.id === update.id) localStorage.setItem(SESSION, JSON.stringify(update));
  };
  const statusText = student => student.telegramSent ? 'Telegramga yuborildi ✓' : student.telegramError ? 'Telegram xatosi' : 'Telegramga yuborilmoqda…';
  async function sendCompletedResult(studentId) {
    const student = getStudents().find(item => item.id === studentId);
    if (!student || !finished(student) || student.telegramSent || sessionStorage.getItem(`telegram-sending-${studentId}`)) return;
    sessionStorage.setItem(`telegram-sending-${studentId}`, '1');
    saveStudent({ ...student, telegramError: null });
    try {
      const latest = getStudents().find(item => item.id === studentId);
      const formData = new FormData();
      formData.append('pdf', makePdf(latest), `Anor-School-natija-${latest.fullName.replace(/[^a-z0-9]+/gi, '-')}.pdf`);
      formData.append('filename', `Anor-School-natija-${latest.fullName.replace(/[^a-z0-9]+/gi, '-')}.pdf`);
      formData.append('caption', `${latest.fullName} — ${latest.schoolClass} ${t('sinf')}\n${t('Rus tili diagnostikasi natijasi')}`);
      const response = await fetch('/api/send-telegram', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Telegram xatosi');
      saveStudent({ ...latest, telegramSent: true, telegramError: null });
    } catch (error) {
      const latest = getStudents().find(item => item.id === studentId);
      if (latest) saveStudent({ ...latest, telegramSent: false, telegramError: error.message || 'Telegramga yuborishda xatolik.' });
    } finally {
      sessionStorage.removeItem(`telegram-sending-${studentId}`);
      renderTeacherDashboard(); showDashboard();
    }
  }

  const originalStoreResult = storeResult;
  storeResult = function (...args) { originalStoreResult(...args); const student = currentStudent(); if (student) window.setTimeout(() => sendCompletedResult(student.id), 50); };
  const originalGradeSubmission = gradeSubmission;
  gradeSubmission = function (...args) { originalGradeSubmission(...args); window.setTimeout(() => sendCompletedResult(args[0]), 50); };
  const originalTeacherDashboard = renderTeacherDashboard;
  renderTeacherDashboard = function () {
    originalTeacherDashboard();
    document.querySelectorAll('.student-record').forEach(card => {
      const button = card.querySelector('[data-student-id]'); const student = getStudents().find(item => item.id === button?.dataset.studentId);
      if (!student || !finished(student)) return;
      const actions = card.querySelector('.student-record-actions'); if (!actions || actions.querySelector('.telegram-status')) return;
      const status = document.createElement('span'); status.className = `telegram-status ${student.telegramSent ? 'sent' : 'pending'}`; status.title = student.telegramError || ''; status.textContent = statusText(student);
      actions.prepend(status);
      if (!student.telegramSent) sendCompletedResult(student.id);
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const student = currentStudent(); if (student && !student.role) sendCompletedResult(student.id);
  });
})();
