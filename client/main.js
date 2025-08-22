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

// Modal system for game-wide popups
const Modal = {
    activeModal: null,

    create(config) {
        if (this.activeModal) {
            this.activeModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'game-modal-overlay';
        modal.innerHTML = `
            <div class="game-modal-container">
                <div class="game-modal-header">
                    <h2>${config.title || 'Dialog'}</h2>
                    ${config.allowClose !== false ? '<button class="modal-close" aria-label="Close">×</button>' : ''}
                </div>
                <div class="game-modal-content"></div>
                ${config.actions ? '<div class="game-modal-actions"></div>' : ''}
            </div>
        `;

        // Add content
        const contentContainer = modal.querySelector('.game-modal-content');
        if (typeof config.content === 'string') {
            contentContainer.innerHTML = config.content;
        } else if (config.content instanceof Element) {
            contentContainer.appendChild(config.content);
        }

        // Apply optional className and explicit sizing to the container
        const containerEl = modal.querySelector('.game-modal-container');
        if (config.className) {
            // Support single or multiple classes
            String(config.className).split(/\s+/).forEach(cls => {
                if (cls) containerEl.classList.add(cls);
            });
        }
        if (typeof config.width === 'number') {
            containerEl.style.width = `${config.width}px`;
            containerEl.style.maxWidth = `${config.width}px`;
        }
        if (typeof config.height === 'number') {
            containerEl.style.height = `${config.height}px`;
            containerEl.style.maxHeight = `${config.height}px`;
        }

        // Add action buttons
        if (config.actions) {
            const actionsContainer = modal.querySelector('.game-modal-actions');
            config.actions.forEach(action => {
                const btn = document.createElement('button');
                btn.textContent = action.text || 'OK';
                // Map generic styles to modern sf-btn variants
                const styleMap = { primary: 'sf-btn sf-btn-primary', secondary: 'sf-btn sf-btn-secondary', danger: 'sf-btn sf-btn-danger' };
                btn.className = styleMap[action.style || 'primary'] || 'sf-btn sf-btn-primary';
                btn.onclick = () => {
                    const result = action.action ? action.action() : null;
                    if (result !== false) {
                        this.close(modal);
                    }
                };
                actionsContainer.appendChild(btn);
            });
        }

        // Close button handler
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.onclick = () => {
                if (config.onCancel) config.onCancel();
                this.close(modal);
            };
        }

        // Backdrop click to close (if allowed)
        if (config.allowClose !== false) {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    if (config.onCancel) config.onCancel();
                    this.close(modal);
                }
            };
        }

        // Prevent backdrop clicks from propagating
        modal.querySelector('.game-modal-container').onclick = (e) => {
            e.stopPropagation();
        };

        this.activeModal = modal;
        return modal;
    },

    show(config) {
        const modal = this.create(config);
        document.body.appendChild(modal);
        
        // Prevent game interactions
        const gameContainer = document.querySelector('.game-container');
        if (gameContainer) {
            gameContainer.classList.add('modal-active');
        }
        
        // Focus management
        const container = modal.querySelector('.game-modal-container');
        container.setAttribute('tabindex', '-1');
        container.focus();
        
        // Handle ESC key
        const escHandler = (e) => {
            if (e.key === 'Escape' && config.allowClose !== false) {
                if (config.onCancel) config.onCancel();
                this.close(modal);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        return modal;
    },

    close(modal) {
        if (modal && modal.parentNode) {
            modal.remove();
        }
        
        // Re-enable game interactions
        const gameContainer = document.querySelector('.game-container');
        if (gameContainer) {
            gameContainer.classList.remove('modal-active');
        }
        
        if (this.activeModal === modal) {
            this.activeModal = null;
        }
    },

    confirm(message, onConfirm, onCancel) {
        return this.show({
            title: 'Confirm Action',
            content: `<p style="padding: 20px; text-align: center;">${message}</p>`,
            actions: [
                { text: 'Cancel', style: 'secondary', action: onCancel },
                { text: 'Confirm', style: 'primary', action: onConfirm }
            ]
        });
    },

    alert(message, title = 'Notice') {
        return this.show({
            title,
            content: `<p style="padding: 20px; text-align: center;">${message}</p>`,
            actions: [
                { text: 'OK', style: 'primary' }
            ]
        });
    }
};

// Extend UI object with modal functions
UI.showModal = function(config) {
    return Modal.show(config);
};

UI.confirmAction = function(message, onConfirm, onCancel) {
    return Modal.confirm(message, onConfirm, onCancel);
};

UI.showAlert = function(message, title) {
    return Modal.alert(message, title);
};

UI.closeModal = function() {
    if (Modal.activeModal) {
        Modal.close(Modal.activeModal);
    }
};

// Export for potential future use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Session, UI, Game, Events, apiRequest, Modal };
} 

// Bridge for ESM loading: expose globals on window so legacy modules continue to work
if (typeof window !== 'undefined') {
    window.Session = Session;
    window.UI = UI;
    window.Game = Game;
    window.Events = Events;
    window.apiRequest = apiRequest;
    window.Modal = Modal;
}