import { createContext, useContext, createSignal } from 'solid-js';

const SidebarContext = createContext();

export function SidebarProvider(props) {
    const [isCollapsed, setIsCollapsed] = createSignal(false);
    const [isMobileOpen, setIsMobileOpen] = createSignal(false);
    const toggleSidebar = () => setIsCollapsed(!isCollapsed());
    const toggleMobileSidebar = () => setIsMobileOpen(!isMobileOpen());
    const closeMobileSidebar = () => setIsMobileOpen(false);

    return (
        <SidebarContext.Provider value={{
            isCollapsed,
            isMobileOpen,
            toggleSidebar,
            toggleMobileSidebar,
            closeMobileSidebar
        }}>
            {props.children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within a SidebarProvider');
    }
    return context;
}