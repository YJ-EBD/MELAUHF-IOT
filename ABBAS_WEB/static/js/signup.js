(function () {
  const $ = (id) => document.getElementById(id);

  const idState = $("idState");
  const emailState = $("emailState");

  function setBadge(el, state, text) {
    if (!el) return;
    el.classList.remove("ok", "err");
    if (state === "ok") el.classList.add("ok");
    if (state === "err") el.classList.add("err");
    el.textContent = text || "";
  }

  async function checkId() {
    const userId = ($("user_id").value || "").trim();
    if (!userId) {
      setBadge(idState, "err", "ID를 입력해주세요");
      return;
    }
    try {
      const res = await fetch(`/auth/check-id?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.detail || "failed");
      if (data.exists) setBadge(idState, "err", "이미 사용중");
      else setBadge(idState, "ok", "사용 가능");
    } catch (e) {
      setBadge(idState, "err", "확인 실패");
    }
  }

  async function sendCode() {
    const email = ($("email").value || "").trim();
    if (!email) {
      setBadge(emailState, "err", "이메일 입력 필요");
      return;
    }
    setBadge(emailState, "", "전송 중...");
    try {
      const res = await fetch("/auth/email/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || "failed");
      setBadge(emailState, "", "코드 전송됨");
    } catch (e) {
      setBadge(emailState, "err", "전송 실패");
      alert(e.message || "인증 메일 전송에 실패했습니다.");
    }
  }

  async function verifyCode() {
    const email = ($("email").value || "").trim();
    const code = ($("email_code").value || "").trim();
    if (!email || !code) {
      setBadge(emailState, "err", "이메일/코드 필요");
      return;
    }
    setBadge(emailState, "", "확인 중...");
    try {
      const res = await fetch("/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || "failed");

      const tokenEl = $("email_verify_token");
      if (tokenEl) tokenEl.value = data.verify_token;
      setBadge(emailState, "ok", "인증 완료");
    } catch (e) {
      setBadge(emailState, "err", "인증 실패");
    }
  }

  function onSubmit(e) {
    // client-side minimal checks (서버가 최종 검증)
    const pw = ($("password").value || "").trim();
    const pw2 = ($("password2").value || "").trim();
    if (pw !== pw2) {
      alert("비밀번호 확인이 일치하지 않습니다.");
      e.preventDefault();
      return;
    }
    const v = ($("email_verify_token").value || "").trim();
    if (!v) {
      alert("이메일 인증을 완료해주세요.");
      e.preventDefault();
      return;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btnCheck = $("btnCheckId");
    const btnSend = $("btnSendCode");
    const btnVerify = $("btnVerifyCode");
    const form = $("signupForm");

    if (btnCheck) btnCheck.addEventListener("click", checkId);
    if (btnSend) btnSend.addEventListener("click", sendCode);
    if (btnVerify) btnVerify.addEventListener("click", verifyCode);
    if (form) form.addEventListener("submit", onSubmit);

    setBadge(idState, "", "미확인");
    setBadge(emailState, "", "미인증");
  });
})();
