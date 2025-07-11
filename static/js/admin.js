// Admin functionality
async function createCamera(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = 'Creating... <span class="loading"></span>';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/admin/camera', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('Camera created successfully!', 'success');
            form.reset();
            
            // Add the new camera to the table
            addCameraToTable(result);
            
            // Show camera details
            showCameraDetails(result);
        } else {
            showAlert(result.detail || 'Failed to create camera', 'error');
        }
    } catch (error) {
        console.error('Error creating camera:', error);
        showAlert('Error creating camera', 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function addCameraToTable(camera) {
    const tableBody = document.querySelector('#cameras-table tbody');
    if (!tableBody) return;
    
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${camera.id}</td>
        <td>${camera.name || 'N/A'}</td>
        <td>${camera.location || 'N/A'}</td>
        <td>
            <a href="${camera.public_url}" target="_blank" class="btn btn-sm btn-primary">View</a>
            <a href="${camera.camera_url}" target="_blank" class="btn btn-sm btn-secondary">Stream</a>
            <button onclick="deleteCamera(${camera.id})" class="btn btn-sm btn-danger">Delete</button>
        </td>
    `;
    tableBody.appendChild(row);
}

function showCameraDetails(camera) {
    const detailsHtml = `
        <div class="alert alert-info alert-dismissible fade show mt-3" role="alert">
            <h5>Camera Created Successfully!</h5>
            <p><strong>Public URL:</strong> <a href="${camera.public_url}" target="_blank">${window.location.origin}${camera.public_url}</a></p>
            <p><strong>Camera URL:</strong> <a href="${camera.camera_url}" target="_blank">${window.location.origin}${camera.camera_url}</a></p>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    const form = document.getElementById('camera-form');
    form.insertAdjacentHTML('afterend', detailsHtml);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
        const alert = document.querySelector('.alert-info');
        if (alert) {
            alert.remove();
        }
    }, 10000);
}

async function deleteCamera(cameraId) {
    if (!confirm('Are you sure you want to delete this camera?')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/camera/${cameraId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showAlert('Camera deleted successfully', 'success');
            
            // Remove the row from the table
            const row = document.querySelector(`tr[data-camera-id="${cameraId}"]`);
            if (row) {
                row.remove();
            } else {
                // Fallback: reload the page
                setTimeout(() => window.location.reload(), 1000);
            }
        } else {
            const error = await response.json();
            showAlert(error.detail || 'Failed to delete camera', 'error');
        }
    } catch (error) {
        console.error('Error deleting camera:', error);
        showAlert('Error deleting camera', 'error');
    }
}

// Auto-generate slug from name
function generateSlug() {
    const nameInput = document.getElementById('name');
    const slugInput = document.getElementById('public_slug');
    
    if (nameInput && slugInput && !slugInput.value) {
        const slug = nameInput.value
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        slugInput.value = slug;
    }
}

// Copy to clipboard functionality
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showAlert('Copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showAlert('Failed to copy to clipboard', 'error');
    });
}
