import re

content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()

# Add manifest
head_addition = """
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#4F46E5">
"""
content = content.replace('</title>', '</title>' + head_addition)

# Add SW registration
sw_reg = """
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').then(reg => {
                    console.log('SW registered!', reg);
                }).catch(err => console.log('SW registration failed', err));
            });
        }
"""
content = content.replace('document.addEventListener("DOMContentLoaded", () => {', 'document.addEventListener("DOMContentLoaded", () => {' + sw_reg)

open('c:/Users/User/Desktop/ENAPP/vcl.html', 'w', encoding='utf-8').write(content)
