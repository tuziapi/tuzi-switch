import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import type { Provider } from "@/types";
import { ProviderList } from "@/components/providers/ProviderList";

const useDragSortMock = vi.fn();
const useSortableMock = vi.fn();
const providerCardRenderSpy = vi.fn();

vi.mock("@/hooks/useDragSort", () => ({
  useDragSort: (...args: unknown[]) => useDragSortMock(...args),
}));

vi.mock("@/components/providers/ProviderCard", () => ({
  ProviderCard: (props: any) => {
    providerCardRenderSpy(props);
    const {
      provider,
      onSwitch,
      onEdit,
      onDelete,
      onDuplicate,
      onConfigureUsage,
    } = props;

    return (
      <div data-testid={`provider-card-${provider.id}`}>
        <button
          data-testid={`switch-${provider.id}`}
          onClick={() => onSwitch(provider)}
        >
          switch
        </button>
        <button
          data-testid={`edit-${provider.id}`}
          onClick={() => onEdit(provider)}
        >
          edit
        </button>
        <button
          data-testid={`duplicate-${provider.id}`}
          onClick={() => onDuplicate(provider)}
        >
          duplicate
        </button>
        <button
          data-testid={`usage-${provider.id}`}
          onClick={() => onConfigureUsage(provider)}
        >
          usage
        </button>
        <button
          data-testid={`delete-${provider.id}`}
          onClick={() => onDelete(provider)}
        >
          delete
        </button>
        <span data-testid={`is-current-${provider.id}`}>
          {props.isCurrent ? "current" : "inactive"}
        </span>
        <span data-testid={`drag-attr-${provider.id}`}>
          {props.dragHandleProps?.attributes?.["data-dnd-id"] ?? "none"}
        </span>
      </div>
    );
  },
}));

vi.mock("@/components/UsageFooter", () => ({
  default: () => <div data-testid="usage-footer" />,
}));

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<any>("@dnd-kit/sortable");

  return {
    ...actual,
    useSortable: (...args: unknown[]) => useSortableMock(...args),
  };
});

// Mock hooks that use QueryClient
vi.mock("@/hooks/useStreamCheck", () => ({
  useStreamCheck: () => ({
    checkProvider: vi.fn(),
    isChecking: () => false,
  }),
}));

vi.mock("@/lib/query/failover", () => ({
  useAutoFailoverEnabled: () => ({ data: false }),
  useFailoverQueue: () => ({ data: [] }),
  useAddToFailoverQueue: () => ({ mutate: vi.fn() }),
  useRemoveFromFailoverQueue: () => ({ mutate: vi.fn() }),
  useReorderFailoverQueue: () => ({ mutate: vi.fn() }),
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: overrides.id ?? "provider-1",
    name: overrides.name ?? "Test Provider",
    settingsConfig: overrides.settingsConfig ?? {
      env: { ANTHROPIC_AUTH_TOKEN: "test-key" },
    },
    category: overrides.category,
    createdAt: overrides.createdAt,
    sortIndex: overrides.sortIndex,
    meta: overrides.meta,
    websiteUrl: overrides.websiteUrl,
  };
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  useDragSortMock.mockReset();
  useSortableMock.mockReset();
  providerCardRenderSpy.mockClear();

  useSortableMock.mockImplementation(({ id }: { id: string }) => ({
    setNodeRef: vi.fn(),
    attributes: { "data-dnd-id": id },
    listeners: { onPointerDown: vi.fn() },
    transform: null,
    transition: null,
    isDragging: false,
  }));

  useDragSortMock.mockReturnValue({
    sortedProviders: [],
    sensors: [],
    handleDragEnd: vi.fn(),
  });
});

describe("ProviderList Component", () => {
  it("should render skeleton placeholders when loading", () => {
    const { container } = renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        isLoading
      />,
    );

    const placeholders = container.querySelectorAll(
      ".border-dashed.border-muted-foreground\\/40",
    );
    expect(placeholders).toHaveLength(3);
  });

  it("should show empty state and trigger create callback when no providers exist", () => {
    const handleCreate = vi.fn();
    useDragSortMock.mockReturnValueOnce({
      sortedProviders: [],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        onCreate={handleCreate}
      />,
    );

    const addButton = screen.getByRole("button", {
      name: "provider.addProvider",
    });
    fireEvent.click(addButton);

    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  it("should render in order returned by useDragSort and pass through action callbacks", () => {
    const providerA = createProvider({ id: "a", name: "A" });
    const providerB = createProvider({ id: "b", name: "B" });

    const handleSwitch = vi.fn();
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();
    const handleDuplicate = vi.fn();
    const handleUsage = vi.fn();
    const handleOpenWebsite = vi.fn();

    useDragSortMock.mockReturnValue({
      sortedProviders: [providerB, providerA],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ a: providerA, b: providerB }}
        currentProviderId="b"
        appId="claude"
        onSwitch={handleSwitch}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onConfigureUsage={handleUsage}
        onOpenWebsite={handleOpenWebsite}
      />,
    );

    // Verify sort order
    expect(providerCardRenderSpy).toHaveBeenCalledTimes(2);
    expect(providerCardRenderSpy.mock.calls[0][0].provider.id).toBe("b");
    expect(providerCardRenderSpy.mock.calls[1][0].provider.id).toBe("a");

    // Verify current provider marker
    expect(providerCardRenderSpy.mock.calls[0][0].isCurrent).toBe(true);

    // Drag attributes from useSortable
    expect(
      providerCardRenderSpy.mock.calls[0][0].dragHandleProps?.attributes[
        "data-dnd-id"
      ],
    ).toBe("b");
    expect(
      providerCardRenderSpy.mock.calls[1][0].dragHandleProps?.attributes[
        "data-dnd-id"
      ],
    ).toBe("a");

    // Trigger action buttons
    fireEvent.click(screen.getByTestId("switch-b"));
    fireEvent.click(screen.getByTestId("edit-b"));
    fireEvent.click(screen.getByTestId("duplicate-b"));
    fireEvent.click(screen.getByTestId("usage-b"));
    fireEvent.click(screen.getByTestId("delete-a"));

    expect(handleSwitch).toHaveBeenCalledWith(providerB);
    expect(handleEdit).toHaveBeenCalledWith(providerB);
    expect(handleDuplicate).toHaveBeenCalledWith(providerB);
    expect(handleUsage).toHaveBeenCalledWith(providerB);
    expect(handleDelete).toHaveBeenCalledWith(providerA);

    // Verify useDragSort call parameters
    expect(useDragSortMock).toHaveBeenCalledWith(
      { a: providerA, b: providerB },
      "claude",
    );
  });

  it("filters providers with the search input", () => {
    const providerAlpha = createProvider({ id: "alpha", name: "Alpha Labs" });
    const providerBeta = createProvider({ id: "beta", name: "Beta Works" });

    useDragSortMock.mockReturnValue({
      sortedProviders: [providerAlpha, providerBeta],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ alpha: providerAlpha, beta: providerBeta }}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const searchInput = screen.getByPlaceholderText(
      "Search name, notes, or URL...",
    );
    // Initially both providers are rendered
    expect(screen.getByTestId("provider-card-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "beta" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "gamma" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-card-beta")).not.toBeInTheDocument();
    expect(
      screen.getByText("No providers match your search."),
    ).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "locates once and expires (reduced motion: %s), then can locate the same provider again",
  (reduced) => {
    vi.useFakeTimers();
    const provider = createProvider();
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const complete = vi.fn();
    const client = new QueryClient();
    vi.mocked(window.matchMedia).mockReturnValue({
      ...window.matchMedia(""),
      matches: reduced,
    });
    const request = { providerId: provider.id };
    const show = (
      providers: Record<string, Provider>,
      focusRequest = request,
    ) => (
      <QueryClientProvider client={client}>
        <ProviderList
          providers={providers}
          focusRequest={focusRequest}
          onFocusComplete={complete}
          currentProviderId={provider.id}
          appId="claude"
          onSwitch={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
          onOpenWebsite={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { container, rerender } = render(show({}));
    act(() => vi.advanceTimersByTime(3000));
    expect(complete).not.toHaveBeenCalled();
    useDragSortMock.mockReturnValue({
      sortedProviders: [provider],
      sensors: [],
      handleDragEnd: vi.fn(),
    });
    rerender(show({ [provider.id]: provider }));
    act(() => vi.advanceTimersByTime(100));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({
      block: "center",
      behavior: reduced ? "auto" : "smooth",
    });
    expect(
      container.querySelector('[data-account-focused="true"]'),
    ).not.toBeNull();
    // Ordinary query refetch must not restart scrolling or the lifetime.
    rerender(show({ [provider.id]: { ...provider } }));
    act(() => vi.advanceTimersByTime(2400));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-account-focused="true"]')).toBeNull();
    expect(screen.getByTestId(`is-current-${provider.id}`)).toHaveTextContent(
      "current",
    );
    rerender(show({ [provider.id]: provider }, { ...request }));
    act(() => vi.advanceTimersByTime(100));
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-account-focused="true"]'),
    ).not.toBeNull();
  },
);

it("cancels pending location work when leaving the list", () => {
  vi.useFakeTimers();
  const provider = createProvider();
  const complete = vi.fn();
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const { unmount } = renderWithQueryClient(
    <ProviderList
      providers={{ [provider.id]: provider }}
      focusRequest={{ providerId: provider.id }}
      onFocusComplete={complete}
      currentProviderId=""
      appId="claude"
      onSwitch={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onOpenWebsite={vi.fn()}
    />,
  );
  unmount();
  act(() => vi.advanceTimersByTime(3000));
  expect(scroll).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
