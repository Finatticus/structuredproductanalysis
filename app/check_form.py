import re

content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()

# We need to find the exact sec-add area and fix the toggle and manual wrapper
sec_add_start = content.find('<section id="sec-add">')
sec_books_start = content.find('<section id="sec-books">')

sec_add_content = content[sec_add_start:sec_books_start]

# What does sec_add_content look like right now?
# It has <section id="sec-add">
# then <div style="display:flex; ...>...</div>
# then </div> <!-- Close add-mode-manual --> (which shouldn't be here)
# then <div id="add-mode-trans" ...>...</div>
# then we reach sec-books

# Wait, if add-mode-manual is gone, did the manual add form get deleted?!
