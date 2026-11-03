// Applies the saved theme before the page paints (inlined into <head> by app/layout.tsx). Light is the default.
export const THEME_KEY = 'mtv.theme';
export const THEME_BOOT = `try{if(localStorage.getItem('${THEME_KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;
