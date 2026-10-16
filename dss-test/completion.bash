# Bash tab completion for `node main.js ...` in this folder: completes envs, test names, option names
# (global plus the chosen test's) and option values that have a fixed set of choices. Candidates come
# from main.js itself, so new tests and options complete without editing this file.
#
# Enable it by adding this line to ~/.bashrc:
#   source /home/laddu/my-setup/dss-test/completion.bash

_dss_test_main="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/main.js"

_dss_test_complete() {
    COMPREPLY=()
    # Only for this folder's main.js; any other `node ...` keeps plain file name completion.
    [[ $COMP_CWORD -ge 2 ]] || return 0
    [[ $(realpath -m -- "${COMP_WORDS[1]/#\~/$HOME}" 2>/dev/null) == "$_dss_test_main" ]] || return 0
    mapfile -t COMPREPLY < <(node "$_dss_test_main" --complete "${COMP_LINE:0:COMP_POINT}" 2>/dev/null)
}

complete -o default -F _dss_test_complete node
