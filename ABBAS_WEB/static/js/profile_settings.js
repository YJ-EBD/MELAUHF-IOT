(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function textValue(el, fallback) {
    const value = el && "value" in el ? String(el.value || "").trim() : "";
    return value || fallback;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const imageInput = byId("profileImageInput");
    const imagePreview = byId("profileImagePreview");
    const imageFallback = byId("profileImageFallback");
    const removeInput = byId("removeProfileImage");
    const removeButton = byId("btnRemoveProfileImage");

    const nicknameInput = byId("profileNickname");
    const nameInput = byId("profileName");
    const bioInput = byId("profileBio");
    const emailInput = byId("profileEmail");
    const phoneInput = byId("profilePhone");
    const departmentInput = byId("profileDepartment");
    const locationInput = byId("profileLocation");
    const userIdInput = byId("profileUserId");
    const newPasswordInput = byId("profileNewPassword");
    const confirmPasswordInput = byId("profileConfirmPassword");
    const passwordCheckButton = byId("btnCheckPasswordMatch");
    const passwordMatchMessage = byId("passwordMatchMessage");
    const profileForm = byId("profileSettingsForm");
    const deleteAccountButton = byId("btnDeleteAccount");

    const summaryName = byId("profileSummaryName");
    const summaryBio = byId("profileSummaryBio");
    const summaryEmail = byId("profileSummaryEmail");
    const summaryPhone = byId("profileSummaryPhone");
    const summaryDepartment = byId("profileSummaryDepartment");
    const summaryLocation = byId("profileSummaryLocation");

    let objectUrl = "";
    let deleteConfirmed = false;

    function revokeObjectUrl() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }
    }

    function syncSummary() {
      const userId = textValue(userIdInput, "user");
      const displayName = textValue(nicknameInput, "") || textValue(nameInput, "") || userId;
      const initial = (displayName.charAt(0) || userId.charAt(0) || "U").toUpperCase();

      if (summaryName) summaryName.textContent = displayName;
      if (summaryBio) summaryBio.textContent = textValue(bioInput, "프로필 소개를 입력하면 여기에서 바로 미리볼 수 있습니다.");
      if (summaryEmail) summaryEmail.textContent = textValue(emailInput, "-");
      if (summaryPhone) summaryPhone.textContent = textValue(phoneInput, "-");
      if (summaryDepartment) summaryDepartment.textContent = textValue(departmentInput, "-");
      if (summaryLocation) summaryLocation.textContent = textValue(locationInput, "-");
      if (imageFallback) imageFallback.textContent = initial;
    }

    function setPreview(url) {
      if (!imagePreview || !imageFallback) return;

      if (url) {
        imagePreview.src = url;
        imagePreview.classList.remove("d-none");
        imageFallback.classList.add("d-none");
      } else {
        imagePreview.removeAttribute("src");
        imagePreview.classList.add("d-none");
        imageFallback.classList.remove("d-none");
      }

      if (removeButton) {
        removeButton.disabled = !url;
      }
    }

    function setPasswordMessage(kind, message) {
      if (!passwordMatchMessage) return true;
      passwordMatchMessage.textContent = message || "";
      passwordMatchMessage.classList.remove("is-error", "is-success");
      if (kind === "error") passwordMatchMessage.classList.add("is-error");
      if (kind === "success") passwordMatchMessage.classList.add("is-success");
      return kind !== "error";
    }

    function checkPasswordMatch() {
      const pw = newPasswordInput ? String(newPasswordInput.value || "") : "";
      const pw2 = confirmPasswordInput ? String(confirmPasswordInput.value || "") : "";

      if (!pw && !pw2) {
        return setPasswordMessage("", "");
      }
      if (!pw || !pw2) {
        return setPasswordMessage("error", "비밀번호를 모두 입력해주세요.");
      }
      if (pw.length < 6) {
        return setPasswordMessage("error", "비밀번호는 6자 이상이어야 합니다.");
      }
      if (pw !== pw2) {
        return setPasswordMessage("error", "비밀번호 재확인이 일치하지 않습니다.");
      }
      return setPasswordMessage("success", "비밀번호가 일치합니다.");
    }

    async function confirmDeleteAccount() {
      if (window.Swal && typeof window.Swal.fire === "function") {
        const result = await window.Swal.fire({
          icon: "warning",
          title: "회원탈퇴",
          text: "회원탈퇴를 진행하면 계정과 프로필 정보가 삭제됩니다. 계속하시겠습니까?",
          showCancelButton: true,
          confirmButtonText: "회원탈퇴",
          cancelButtonText: "취소",
          confirmButtonColor: "#d94356",
          reverseButtons: true,
          focusCancel: true,
        });
        return !!result.isConfirmed;
      }
      return window.confirm("회원탈퇴를 진행하면 계정과 프로필 정보가 삭제됩니다. 계속하시겠습니까?");
    }

    if (imageInput) {
      imageInput.addEventListener("change", () => {
        const file = imageInput.files && imageInput.files[0];
        revokeObjectUrl();

        if (file) {
          if (removeInput) removeInput.value = "0";
          objectUrl = URL.createObjectURL(file);
          setPreview(objectUrl);
        } else if (!(imagePreview && imagePreview.getAttribute("src"))) {
          setPreview("");
        }
      });
    }

    if (removeButton) {
      removeButton.addEventListener("click", () => {
        revokeObjectUrl();
        if (imageInput) imageInput.value = "";
        if (removeInput) removeInput.value = "1";
        setPreview("");
      });
    }

    [nicknameInput, nameInput, bioInput, emailInput, phoneInput, departmentInput, locationInput].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", syncSummary);
    });

    [newPasswordInput, confirmPasswordInput].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", () => {
        setPasswordMessage("", "");
      });
    });

    if (passwordCheckButton) {
      passwordCheckButton.addEventListener("click", () => {
        checkPasswordMatch();
      });
    }

    if (profileForm) {
      profileForm.addEventListener("submit", async (ev) => {
        const submitter = ev.submitter;
        if (submitter === deleteAccountButton) {
          if (deleteConfirmed) {
            deleteConfirmed = false;
            return;
          }
          ev.preventDefault();
          const ok = await confirmDeleteAccount();
          if (!ok) {
            return;
          }
          deleteConfirmed = true;
          if (typeof profileForm.requestSubmit === "function") {
            profileForm.requestSubmit(deleteAccountButton);
          } else {
            profileForm.submit();
          }
          return;
        }

        const hasPasswordValue = (newPasswordInput && newPasswordInput.value) || (confirmPasswordInput && confirmPasswordInput.value);
        if (hasPasswordValue && !checkPasswordMatch()) {
          ev.preventDefault();
          if (confirmPasswordInput) {
            confirmPasswordInput.focus();
          }
        }
      });
    }

    syncSummary();
  });
})();
