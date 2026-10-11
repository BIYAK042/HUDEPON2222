
const $ = (selector) => document.querySelector(selector);

const content = $("#gallery-content");
const photoInput = $("#photo-input");
const searchInput = $("#search-input");
const selectionToolbar = $("#selection-toolbar");
const selectionCount = $("#selection-count");
const dialog = $("#app-dialog");
const dialogContent = $("#dialog-content");

let db;
let photos = [];
let albums = [];
let currentView = "all";
let currentAlbumId = null;
let selectedIds = new Set();
let selectionMode = false;
let viewerIndex = 0;

const selectedClass = "selected";

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("VioletStudioGallery", 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("photos")) {
        const store = database.createObjectStore("photos", {
          keyPath: "id"
        });
        store.createIndex("createdAt", "createdAt");
      }

      if (!database.objectStoreNames.contains("albums")) {
        database.createObjectStore("albums", {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    try {
      result = action(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePhoto(photo) {
  await transaction("photos", "readwrite", (store) => store.put(photo));
}

async function saveAlbum(album) {
  await transaction("albums", "readwrite", (store) => store.put(album));
}

async function deletePhoto(id) {
  await transaction("photos", "readwrite", (store) => store.delete(id));
}



async function refreshData() {
  photos.forEach((photo) => {
    if (photo.url) {
      URL.revokeObjectURL(photo.url);
    }
  });

  photos = (await getAll("photos"))
    .sort((a, b) => b.createdAt - a.createdAt);

  photos.forEach((photo) => {
    if (photo.blob) {
      photo.url = URL.createObjectURL(photo.blob);
    }
  });

  albums = await getAll("albums");
  render();
}


function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function getVisiblePhotos() {
  const query = searchInput.value.trim().toLocaleLowerCase();

  let result = photos;

  if (currentView === "favorites") {
    result = result.filter((photo) => photo.favorite);
  } else if (currentView === "album") {
    const album = albums.find((item) => item.id === currentAlbumId);
    result = album
      ? result.filter((photo) => album.photoIds.includes(photo.id))
      : [];
  }

  if (query) {
    result = result.filter((photo) =>
      photo.name.toLocaleLowerCase().includes(query)
    );
  }

  return result;
}

function render() {
  const visiblePhotos = getVisiblePhotos();

  $("#screen-title").textContent =
    currentView === "albums" ? "앨범" :
    currentView === "favorites" ? "즐겨찾기" :
    currentView === "album"
      ? albums.find((item) => item.id === currentAlbumId)?.name || "앨범"
      : "갤러리";

  selectionToolbar.hidden = !selectionMode;
  selectionCount.textContent = `${selectedIds.size}개 선택됨`;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === currentView);
  });

  $("#add-photos").hidden = currentView === "albums";
  $("#search-input").placeholder =
    currentView === "albums" ? "앨범 검색" : "사진 파일명 검색";

  if (currentView === "albums") {
    renderAlbums();
    return;
  }

  if (visiblePhotos.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">✧</span>
        <div>${currentView === "favorites"
          ? "즐겨찾기한 사진이 없어."
          : currentView === "album"
            ? "이 앨범에는 아직 사진이 없어."
            : "아직 사진이 없어."}</div>
        <div>＋ 버튼을 눌러 사진을 추가해 봐!</div>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="photo-grid">
      ${visiblePhotos.map((photo) => `
        <button class="photo-item ${selectedIds.has(photo.id) ? selectedClass : ""}"
          data-photo-id="${escapeHTML(photo.id)}"
          aria-label="${escapeHTML(photo.name)}">
          <img src="${photo.url}" alt="${escapeHTML(photo.name)}" loading="lazy">
          ${selectionMode ? `
            <span class="photo-check">${selectedIds.has(photo.id) ? "✓" : ""}</span>
          ` : ""}
        </button>
      `).join("")}
    </div>`;

  content.querySelectorAll(".photo-item").forEach((button) => {
    const id = button.dataset.photoId;
    let holdTimer;
    let didLongPress = false;

    button.addEventListener("pointerdown", () => {
      didLongPress = false;
      holdTimer = setTimeout(() => {
        didLongPress = true;
        selectionMode = true;
        toggleSelection(id);
      }, 500);
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
      button.addEventListener(eventName, () => clearTimeout(holdTimer));
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      didLongPress = true;
      selectionMode = true;
      toggleSelection(id);
    });

    button.addEventListener("click", () => {
      if (didLongPress) return;

      if (selectionMode) {
        toggleSelection(id);
      } else {
        openViewer(id);
      }
    });
  });
}

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }

  if (selectedIds.size === 0) {
    selectionMode = false;
  }

  render();
}

function clearSelection() {
  selectedIds.clear();
  selectionMode = false;
  render();
}

function renderAlbums() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visibleAlbums = albums.filter((album) =>
    album.name.toLocaleLowerCase().includes(query)
  );

  content.innerHTML = `
    <div class="album-grid">
      ${visibleAlbums.map((album) => `
        <button class="album-card" data-album-id="${escapeHTML(album.id)}">
          <div class="album-cover">▧</div>
          <div class="album-info">
            <strong>${escapeHTML(album.name)}</strong>
            <small>${album.photoIds.length}장</small>
          </div>
        </button>
      `).join("")}
      <button class="album-card" id="create-album-card">
        <div class="album-cover">＋</div>
        <div class="album-info"><strong>새 앨범</strong></div>
      </button>
    </div>`;

  content.querySelectorAll("[data-album-id]").forEach((button) => {
    button.addEventListener("click", () => {
      currentAlbumId = button.dataset.albumId;
      currentView = "album";
      render();
    });
  });

  $("#create-album-card").addEventListener("click", createAlbum);
}

async function importPhotos(files) {
  const imageFiles = Array.from(files).filter((file) =>
    file.type.startsWith("image/")
  );

  if (imageFiles.length === 0) {
    alert("이미지 파일을 선택해 줘!");
    return;
  }

  try {
    for (const file of imageFiles) {
      const photo = {
        id: makeId(),
        name: file.name,
        blob: file,
        createdAt: Date.now(),
        favorite: false
      };

      await savePhoto(photo);
    }

    await refreshData();
  } catch (error) {
    console.error(error);
    alert("사진을 저장하지 못했어. 저장 공간을 확인해 줘.");
  }
}

function openViewer(id) {
  const visiblePhotos = getVisiblePhotos();
  viewerIndex = visiblePhotos.findIndex((photo) => photo.id === id);
  if (viewerIndex < 0) return;

  showViewer(visiblePhotos);
}

function showViewer(list) {
  const photo = list[viewerIndex];
  if (!photo) return;

  dialogContent.innerHTML = `
    <div>
      <strong>${escapeHTML(photo.name)}</strong>
    </div>
    <img class="large-photo" src="${photo.url}" alt="${escapeHTML(photo.name)}">
    <div class="dialog-actions">
      <button id="viewer-prev" aria-label="이전 사진">‹</button>
      <button id="viewer-favorite">${photo.favorite ? "♥ 즐겨찾기 해제" : "♡ 즐겨찾기"}</button>
      <button id="viewer-delete">삭제</button>
      <button id="viewer-next" aria-label="다음 사진">›</button>
      <button id="viewer-close">닫기</button>
    </div>`;

  if (!dialog.open) dialog.showModal();

  $("#viewer-close").onclick = () => dialog.close();

  $("#viewer-prev").onclick = () => {
    if (viewerIndex > 0) {
      viewerIndex--;
      showViewer(list);
    }
  };

  $("#viewer-next").onclick = () => {
    if (viewerIndex < list.length - 1) {
      viewerIndex++;
      showViewer(list);
    }
  };

  $("#viewer-favorite").onclick = async () => {
    photo.favorite = !photo.favorite;
    await savePhoto(photo);
    await refreshData();
    showViewer(list);
  };

  $("#viewer-delete").onclick = async () => {
    if (!confirm("이 사진을 삭제할까?")) return;

    await deletePhoto(photo.id);

    for (const album of albums) {
      album.photoIds = album.photoIds.filter((photoId) => photoId !== photo.id);
      await saveAlbum(album);
    }

    await refreshData();

    const updatedList = getVisiblePhotos();
    if (updatedList.length === 0) {
      dialog.close();
    } else {
      viewerIndex = Math.min(viewerIndex, updatedList.length - 1);
      showViewer(updatedList);
    }
  };
}

async function createAlbum() {
  const name = prompt("새 앨범 이름을 입력해 줘.");
  if (!name || !name.trim()) return;

  await saveAlbum({
    id: makeId(),
    name: name.trim(),
    photoIds: [],
    createdAt: Date.now()
  });

  await refreshData();
}

$("#add-photos").addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async () => {
  await importPhotos(photoInput.files);
  photoInput.value = "";
});

searchInput.addEventListener("input", render);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    clearSelection();
    currentView = tab.dataset.view;
    currentAlbumId = null;
    render();
  });
});

$("#back-button").addEventListener("click", () => {
  if (selectionMode) {
    clearSelection();
  } else if (currentView === "album") {
    currentView = "albums";
    currentAlbumId = null;
    render();
  } else {
    currentView = "all";
    render();
  }
});

$("#home-button").addEventListener("click", () => {
  alert("홈 화면 연결은 Violet Studio 홈 화면을 만들 때 추가할게!");
});

$("#delete-selected").addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`선택한 사진 ${selectedIds.size}장을 삭제할까?`)) return;

  for (const id of selectedIds) {
    await deletePhoto(id);

    for (const album of albums) {
      album.photoIds = album.photoIds.filter((photoId) => photoId !== id);
      await saveAlbum(album);
    }
  }

  clearSelection();
  await refreshData();
});

$("#add-to-album").addEventListener("click", async () => {
  if (selectedIds.size === 0) return;

  if (albums.length === 0) {
    alert("먼저 앨범을 만들어 줘!");
    return;
  }

  const choices = albums.map((album, index) =>
    `${index + 1}. ${album.name}`
  ).join("\n");

  const answer = prompt(`어느 앨범에 추가할까?\n${choices}\n번호를 입력해 줘.`);
  const index = Number(answer) - 1;
  const album = albums[index];

  if (!album) return;

  album.photoIds = [...new Set([...album.photoIds, ...selectedIds])];
  await saveAlbum(album);

  clearSelection();
  await refreshData();
  alert("앨범에 사진을 추가했어!");
});

async function initialize() {
  try {
    db = await openDatabase();

    await refreshData();

    $("#device-time").textContent =
      new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date());

    setInterval(() => {
      $("#device-time").textContent =
        new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(new Date());
    }, 10000);
  } catch (error) {
    console.error(error);
    content.innerHTML = `
      <div class="empty-state">
        갤러리를 시작하지 못했어.<br>
        브라우저가 저장 기능을 지원하는지 확인해 줘.
      </div>`;
  }
}

initialize();

