import { createContext, useContext, createSignal, createEffect } from 'solid-js';

const ThemeContext = createContext();

export function ThemeProvider(props) {
    // One-time migration: the previous version auto-enabled dark from the OS
    // preference AND persisted 'dark', so dark-mode-device users got 'dark'
    // saved without ever choosing it. Wipe that once so everyone re-defaults
    // to light; explicit toggles from now on still persist normally.
    if (!localStorage.getItem('theme_pref_v2')) {
        localStorage.removeItem('theme');
        localStorage.setItem('theme_pref_v2', '1');
    }

    const [isDark, setIsDark] = createSignal(
        localStorage.getItem('theme') === 'dark'
    );

    createEffect(() => {
        const root = document.documentElement;
        if (isDark()) {
            root.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            root.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    });

    const toggleTheme = () => setIsDark(!isDark());

    return (
        <ThemeContext.Provider value={{ isDark, toggleTheme }}>
            {props.children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}