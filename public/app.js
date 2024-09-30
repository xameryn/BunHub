document.addEventListener('DOMContentLoaded', () => {
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const dropArea = document.getElementById('drop-area');
  const fileList = document.getElementById('file-list');

  let currentUser = null;

  // Check login status
  fetch('/auth-status')
    .then(response => response.json())
    .then(user => {
      if (user.isAuthenticated) {
        currentUser = user.username; // Store the authenticated username
        authStatus.innerText = `Logged in as: ${user.username}`;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
      } else {
        authStatus.innerText = 'Not logged in';
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
      }
    });

  // Fetch the file list and display it
  fetch('/files')
    .then(response => response.json())
    .then(files => {
      files.forEach(file => {
        const link = document.createElement('a');
        link.href = `/download/${file.filename}`;
        link.innerText = `${file.filename}`;
        fileList.appendChild(link);
      });
    });
  
  // Drag and drop functionality
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  dropArea.addEventListener('dragenter', () => {
    dropArea.classList.add('dragging');
  });
  
  dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('dragging');
  });
  
  dropArea.addEventListener('drop', (e) => {
    dropArea.classList.remove('dragging');
    const files = e.dataTransfer.files;
    [...files].forEach(uploadFile);
  });

  // Upload the file and use the authenticated Discord username
  function uploadFile(file) {
    if (!currentUser) {
      console.error('User is not authenticated.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploader', currentUser); // Use the Discord username as the uploader

    fetch('/upload', {
      method: 'POST',
      body: formData
    })
      .then(response => response.text())
      .then(() => {
        const link = document.createElement('a');
        link.href = `/download/${file.name}`;
        link.innerText = `${file.name}`;
        fileList.appendChild(link);
      })
      .catch(error => console.error('Error uploading file:', error));
  }

  // Function to update the file list
  function updateFileList() {
    fetch('/files')
      .then(response => response.json())
      .then(files => {
        fileList.innerHTML = ''; // Clear the current list
        files.forEach(file => {
          const link = document.createElement('a');
          link.href = `/download/${file.filename}`;
          link.innerText = `${file.filename}`;
          fileList.appendChild(link);
        });
      });
  }

  // Poll for file list updates every 10 seconds
  updateFileList();
  setInterval(updateFileList, 2000);
});
