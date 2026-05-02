fn main() {
    let detection_manifest = std::path::Path::new("../detection/Cargo.toml");
    if !detection_manifest.exists() {
        panic!(
            "\n\n\
             Detection submodule is not initialized.\n\
             From the repo root, run:\n\
             \n  \
             git submodule update --init --recursive\n\
             \n\
             (Requires SSH access to the private brawltome-detection repo.)\n\
             "
        );
    }

    tauri_build::build()
}
