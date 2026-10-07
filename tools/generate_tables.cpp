#include "fast_eval.hpp"
#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "Usage: generate_tables output.bin\n"; return 2; }
    auto table = poker::generate_omaha_table();
    std::ofstream out(argv[1], std::ios::binary);
    // Explicit little-endian encoding makes the packaged file portable.
    for (auto v : table) { out.put(char(v & 255)); out.put(char(v >> 8)); }
    if (!out) return 1;
    std::cout << "Generated " << table.size() << " direct Omaha lookup entries.\n";
}
