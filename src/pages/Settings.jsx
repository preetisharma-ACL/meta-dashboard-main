import { createSignal } from 'solid-js';

export default function Settings() {
    const [notifications, setNotifications] = createSignal(true);
    const [emailAlerts, setEmailAlerts] = createSignal(true);
    const [autoSave, setAutoSave] = createSignal(false);

    return (
        <div class="p-6 max-w-4xl">
            <div class="mb-8">
                <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
                <p class="text-gray-600 dark:text-gray-400 mt-1">
                    Manage your account settings and preferences
                </p>
            </div>

            <div class="space-y-6">
                {/* Profile Settings */}
                <div class="card p-6">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">
                        Profile Settings
                    </h2>
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Full Name
                                </label>
                                <input
                                    type="text"
                                    value="Preeti Sharma"
                                    class="input-field"
                                />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value="preetiaajneeti@gmail.com"
                                    class="input-field"
                                />
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Company
                            </label>
                            <input
                                type="text"
                                value="Aajneeti Connect Ltd"
                                class="input-field"
                            />
                        </div>
                        <div class="flex gap-3 pt-4">
                            <button class="btn-primary">Save Changes</button>
                            <button class="btn-secondary">Cancel</button>
                        </div>
                    </div>
                </div>

                {/* Notification Settings */}
                <div class="card p-6">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">
                        Notifications
                    </h2>
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="font-medium text-gray-900 dark:text-white">
                                    Push Notifications
                                </p>
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Receive push notifications for important updates
                                </p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={notifications()}
                                    onChange={(e) => setNotifications(e.target.checked)}
                                    class="sr-only peer"
                                />
                                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>

                        <div class="flex items-center justify-between">
                            <div>
                                <p class="font-medium text-gray-900 dark:text-white">
                                    Email Alerts
                                </p>
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Get email notifications for new leads and deals
                                </p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={emailAlerts()}
                                    onChange={(e) => setEmailAlerts(e.target.checked)}
                                    class="sr-only peer"
                                />
                                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>

                        <div class="flex items-center justify-between">
                            <div>
                                <p class="font-medium text-gray-900 dark:text-white">
                                    Auto-save
                                </p>
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Automatically save your work as you type
                                </p>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={autoSave()}
                                    onChange={(e) => setAutoSave(e.target.checked)}
                                    class="sr-only peer"
                                />
                                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Security */}
                <div class="card p-6">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">
                        Security
                    </h2>
                    <div class="space-y-4">
                        <button class="w-full md:w-auto btn-secondary">
                            Change Password
                        </button>
                        <button class="w-full md:w-auto btn-secondary ml-0 md:ml-3 mt-3 md:mt-0">
                            Enable Two-Factor Authentication
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}