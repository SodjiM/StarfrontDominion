// Starfront: Dominion - Shared JavaScript utilities

// API base URL
const API_BASE = '';

// Utility function to make API requests
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        const data = await response.json();
        
        return {
            success: response.ok,
            data,
            status: response.status
        };
    } catch (error) {
        return {
            success: false,
            error: 'Network error',
            status: 0
        };
    }
}

// User session management
const Session = {
    // Check if user is logged in
    isLoggedIn() {
        return !!localStorage.getItem('userId');
    },
    
    // Get current user data
    getUser() {
        const userId = localStorage.getItem('userId');
        const username = localStorage.getItem('username');
        
        if (userId && username) {
            return { userId: parseInt(userId), username };
        }
        return null;
    },
    
    // Set user session
    setUser(userId, username) {
        localStorage.setItem('userId', userId.toString());
        localStorage.setItem('username', username);
    },
    
    // Clear user session
    clearUser() {
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
    },
    
    // Redirect to login if not authenticated
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }
};

// Utility functions for UI
const UI = {
    // Show loading state on an element
    showLoading(element, message = 'Loading...') {
        element.innerHTML = `<div style="text-align: center; color: #64b5f6; padding: 20px;">
            🚀 ${message}
        </div>`;
    },
    
    // Show error message
    showError(element, message) {
        element.innerHTML = `<div style="text-align: center; color: #f44336; padding: 20px;">
            ❌ ${message}
        </div>`;
    },
    
    // Show empty state
    showEmpty(element, message = 'No data available') {
        element.innerHTML = `<div style="text-align: center; color: #666; padding: 20px;">
            ${message}
        </div>`;
    },
    
    // Format date for display
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    },
    
    // Create status badge
    createStatusBadge(status) {
        const statusClasses = {
            'recruiting': 'status-recruiting',
            'active': 'status-active',
            'finished': 'status-finished'
        };
        
        const className = statusClasses[status] || 'status-recruiting';
        return `<span class="game-status ${className}">${status.toUpperCase()}</span>`;
    }
};

// Game-specific utilities
const Game = {
    // Format game mode for display
    formatMode(mode) {
        const modes = {
            'campaign': 'Campaign',
            'persistent': 'Persistent Galaxy'
        };
        return modes[mode] || mode;
    },
    
    // Check if game is joinable
    isJoinable(game) {
        return game.status === 'recruiting';
    },
    
    // Get game type icon
    getGameIcon(mode) {
        const icons = {
            'campaign': '🎯',
            'persistent': '🌌'
        };
        return icons[mode] || '🎮';
    }
};

// Event handling utilities
const Events = {
    // Debounce function calls
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Handle form submissions with loading states
    async handleFormSubmit(form, submitHandler) {
        const submitButton = form.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        
        try {
            submitButton.disabled = true;
            submitButton.textContent = 'Processing...';
            
            await submitHandler();
        } catch (error) {
            console.error('Form submission error:', error);
            throw error;
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }
};

// Global error handler
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Could show a global error notification here
});

// Global keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // ESC key to close modals/details
    if (event.key === 'Escape') {
        // Try to close any open details panels
        const gameDetails = document.getElementById('gameDetails');
        if (gameDetails && gameDetails.style.display !== 'none') {
            gameDetails.style.display = 'none';
        }
    }
});

// Export for potential future use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Session, UI, Game, Events, apiRequest };
} 