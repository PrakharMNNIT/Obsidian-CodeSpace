export class TargetRegistry<T extends object> {
	private targetByItem = new WeakMap<T, string>();
	private itemsByTarget = new Map<string, Set<T>>();

	track(item: T, target: string): void {
		const previousTarget = this.targetByItem.get(item);
		if (previousTarget === target) return;
		if (previousTarget) {
			this.removeFromTarget(item, previousTarget);
		}

		this.targetByItem.set(item, target);
		let items = this.itemsByTarget.get(target);
		if (!items) {
			items = new Set<T>();
			this.itemsByTarget.set(target, items);
		}
		items.add(item);
	}

	untrack(item: T): void {
		const target = this.targetByItem.get(item);
		if (!target) return;
		this.removeFromTarget(item, target);
		this.targetByItem.delete(item);
	}

	get(target: string): T[] {
		return Array.from(this.itemsByTarget.get(target) ?? []);
	}

	clear(): void {
		this.itemsByTarget.clear();
		this.targetByItem = new WeakMap<T, string>();
	}

	private removeFromTarget(item: T, target: string): void {
		const items = this.itemsByTarget.get(target);
		items?.delete(item);
		if (items?.size === 0) {
			this.itemsByTarget.delete(target);
		}
	}
}
