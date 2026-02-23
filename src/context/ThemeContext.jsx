import { createContext, useContext, createSignal, createEffect } from 'solid-js';

const ThemeContext = createContext();

export function ThemeProvider(props) {
    const [isDark, setIsDark] = createSignal(
        localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
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