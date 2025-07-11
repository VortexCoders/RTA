// Camera search functionality
async function searchCameras() {
    const searchTerm = document.getElementById('search-input').value;
    const response = await fetch(`/search?q=${encodeURIComponent(searchTerm)}`);
    const cameras = await response.json();
    
    const grid = document.getElementById('cameras-grid');
    grid.innerHTML = '';
    
    cameras.forEach(camera => {
        const card = createCameraCard(camera);
        grid.appendChild(card);
    });
    
    if (cameras.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #7f8c8d; grid-column: 1 / -1;">No cameras found matching your search.</p>';
    }
}

function createCameraCard(camera) {
    const card = document.createElement('div');
    card.className = 'camera-card';
    card.innerHTML = `
        <h3>${camera.name}</h3>
        <div class="camera-info">
            <p><strong>Location:</strong> ${camera.location}</p>
        </div>
        <a href="/view/${camera.slug}" class="btn btn-primary">View Stream</a>
    `;
    return card;
}

// Service Worker registration for PWA functionality
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/static/sw.js')
            .then(function(registration) {
                console.log('ServiceWorker registration successful');
            })
            .catch(function(err) {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// Web Push notifications
async function enableNotifications(cameraId) {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('your-vapid-public-key')
            });
            
            await fetch(`/subscribe/${cameraId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(subscription)
            });
            
            showAlert('Notifications enabled!', 'success');
        } catch (error) {
            console.error('Failed to enable notifications:', error);
            showAlert('Failed to enable notifications', 'error');
        }
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Helper function for alerts
function showAlert(message, type) {
    const alertClass = type === 'error' ? 'alert-danger' : 'alert-success';
    const alertHtml = `
        <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    const container = document.querySelector('.container') || document.body;
    container.insertAdjacentHTML('afterbegin', alertHtml);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) {
            alert.remove();
        }
    }, 5000);
}
