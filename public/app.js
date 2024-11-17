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

        // Fetch the file list and start polling
        updateFileList();
        setInterval(updateFileList, 2000);
      } else {
        authStatus.innerText = 'Not logged in';
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
      }
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
        updateFileList(); // Update the file list after the upload is complete
      })
      .catch(error => console.error('Error uploading file:', error));
  }

  // Function to update the file list
  function updateFileList() {
    if (!currentUser) {
      return;
    }
    fetch('/files')
      .then(response => response.json())
      .then(files => {
        fileList.innerHTML = '';
        files.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.classList.add('file-item');

          const fileName = document.createElement('span');
          fileName.innerText = file.filename;
          fileItem.appendChild(fileName);

          // Copy button
          const copyButton = document.createElement('button');
          copyButton.classList.add('copy-button');
          copyButton.innerHTML = '<i class="fas fa-copy"></i>';
          copyButton.addEventListener('click', () => {
            // For HLS streams, create an HTML page with video player
            if (file.url.includes('/hls/')) {
              const playerUrl = `/player.html?video=${encodeURIComponent(file.url)}`;
              navigator.clipboard.writeText(playerUrl).then(() => {
                showNotification('Video player link copied to clipboard');
              });
            } else {
              navigator.clipboard.writeText(file.url).then(() => {
                showNotification('Link copied to clipboard');
              });
            }
          });
          fileItem.appendChild(copyButton);

          // Download button
          const downloadButton = document.createElement('button');
          downloadButton.classList.add('download-button');
          downloadButton.innerHTML = '<i class="fas fa-download"></i>';
          downloadButton.addEventListener('click', () => {
            window.location.href = `/download/${encodeURIComponent(file.filename)}`;
          });
          fileItem.appendChild(downloadButton);

          // Delete button
          const deleteButton = document.createElement('button');
          deleteButton.classList.add('delete-button');
          deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
          deleteButton.addEventListener('click', () => deleteFile(file.filename));
          fileItem.appendChild(deleteButton);

          fileList.appendChild(fileItem);
        });
      })
      .catch(error => console.error('Error fetching file list:', error));
  }

  function deleteFile(filename) {
    fetch(`/delete/${filename}`, {
      method: 'DELETE'
    })
      .then(response => response.text())
      .then(() => {
        updateFileList(); // Refresh the file list after deletion
      })
      .catch(error => console.error('Error deleting file:', error));
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.classList.add('notification');
    notification.textContent = message;
    document.body.appendChild(notification);

    // Trigger the fade in
    setTimeout(() => notification.classList.add('show'), 10);

    // Remove the notification after 2 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300); // Remove from DOM after fade animation
    }, 2000);
  }
});
