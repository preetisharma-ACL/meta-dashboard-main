import { createSignal, Show } from 'solid-js';
import { useSidebar } from '../context/SidebarContext';
import { useTheme } from '../context/ThemeContext';

export default function Header() {
    const { isCollapsed, toggleSidebar, toggleMobileSidebar } = useSidebar();
    const { isDark, toggleTheme } = useTheme();
    const [showUserMenu, setShowUserMenu] = createSignal(false);
    const [showNotifications, setShowNotifications] = createSignal(false);

    const notifications = [
        { id: 1, title: 'New lead assigned', message: 'John Doe has been assigned to you', time: '5 min ago', unread: true },
        { id: 2, title: 'Meeting reminder', message: 'Sales meeting in 30 minutes', time: '25 min ago', unread: true },
        { id: 3, title: 'Deal closed', message: 'ABC Corp deal successfully closed', time: '2 hours ago', unread: false },
    ];

    return (
        <header class="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
            <div class="h-full px-4 flex items-center justify-between">
                {/* Left Section */}
                <div class="flex items-center gap-4">
                    {/* Mobile Menu Button */}
                    <button
                        onClick={toggleMobileSidebar}
                        class="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>

                    {/* Desktop Collapse Button */}
                    <button
                        onClick={toggleSidebar}
                        class="hidden lg:block p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>

                    {/* Search Bar */}
                    <div class="hidden md:flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2 w-96">
                        <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search..."
                            class="bg-transparent border-none outline-none text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 w-full"
                        />
                    </div>
                </div>

                {/* Right Section */}
                <div class="flex items-center gap-3">
                    {/* Theme Toggle */}
                    <button
                        onClick={toggleTheme}
                        class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title={isDark() ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        <Show
                            when={isDark()}
                            fallback={
                                <svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                </svg>
                            }
                        >
                            <svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </Show>
                    </button>

                    {/* Notifications */}
                    <div class="relative">
                        <button
                            onClick={() => setShowNotifications(!showNotifications())}
                            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
                        >
                            <svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                            <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                        </button>

                        {/* Notifications Dropdown */}
                        <Show when={showNotifications()}>
                            <div class="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <div class="p-4 border-b border-gray-200 dark:border-gray-700">
                                    <h3 class="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                                </div>
                                <div class="max-h-96 overflow-y-auto">
                                    <For each={notifications}>
                                        {(notif) => (
                                            <div class={`p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${notif.unread ? 'bg-primary-50 dark:bg-primary-900/10' : ''
                                                }`}>
                                                <div class="flex items-start gap-3">
                                                    <div class={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${notif.unread ? 'bg-primary-500' : 'bg-gray-300'
                                                        }`}></div>
                                                    <div class="flex-1">
                                                        <h4 class="text-sm font-medium text-gray-900 dark:text-white">{notif.title}</h4>
                                                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{notif.message}</p>
                                                        <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{notif.time}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </For>
                                </div>
                                <div class="p-3 text-center border-t border-gray-200 dark:border-gray-700">
                                    <button class="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                                        View all notifications
                                    </button>
                                </div>
                            </div>
                        </Show>
                    </div>

                    {/* User Menu */}
                    <div class="relative">
                        <button
                            onClick={() => setShowUserMenu(!showUserMenu())}
                            class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            <div class="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                                ACL
                            </div>
                            <div class="hidden md:block text-left">
                                <p class="text-sm font-medium text-gray-900 dark:text-white">Preeti Sharma</p>
                                <p class="text-xs text-gray-500 dark:text-gray-400">Aajneeti Connect ltd</p>
                            </div>
                            <svg class="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {/* User Dropdown */}
                        <Show when={showUserMenu()}>
                            <div class="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <div class="p-3 border-b border-gray-200 dark:border-gray-700">
                                    <p class="text-sm font-medium text-gray-900 dark:text-white">Preeti Sharma</p>
                                    <p class="text-xs text-gray-500 dark:text-gray-400">admin@aajneeti.com</p>
                                </div>
                                <div class="py-2">
                                    <button class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        Profile Settings
                                    </button>
                                    <button class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        Account Settings
                                    </button>
                                    <button class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        Help Center
                                    </button>
                                </div>
                                <div class="border-t border-gray-200 dark:border-gray-700">
                                    <button class="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </header>
    );
}