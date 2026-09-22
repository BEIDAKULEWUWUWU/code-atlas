package main

import (
	"flag"
	"fmt"
	"os"
	"sort"
)

type entry struct {
	Name string
	Size int
}

func main() {
	limit := flag.Int("limit", 10, "how many entries to print")
	flag.Parse()

	entries := []entry{{"alpha", 120}, {"beta", 40}, {"gamma", 900}}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Size > entries[j].Size })

	for i, e := range entries {
		if i >= *limit {
			break
		}
		fmt.Fprintf(os.Stdout, "%-8s %6d\n", e.Name, e.Size)
	}
}
