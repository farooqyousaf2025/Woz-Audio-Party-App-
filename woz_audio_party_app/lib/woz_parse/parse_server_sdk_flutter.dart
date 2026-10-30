/// Flutter side of the Woz Parse facade: the live list/grid widgets and the
/// SharedPreferences-backed store, mirroring parse_server_sdk_flutter 8.0.0.
library woz_parse_flutter;

import 'dart:async';

import 'package:flutter/material.dart';

import 'package:woz_audio_party_app/woz_parse/parse_server_sdk.dart';

export 'package:woz_audio_party_app/woz_parse/parse_server_sdk.dart';

typedef ChildBuilder<T extends ParseObject> = Widget Function(
    BuildContext context, ParseLiveListElementSnapshot<T> snapshot);

typedef StreamGetter<T extends ParseObject> = Stream<T> Function();

typedef DataGetter<T extends ParseObject> = T? Function();

/// Same surface as the old `CoreStoreSembast`, but backed by SharedPreferences.
class CoreStoreSembast implements CoreStore {
  CoreStoreSembast._(this._delegate);

  final CoreStore _delegate;

  static Future<CoreStoreSembast> getInstance(
      {String? password, String? fileName}) async {
    final CoreStore store = await CoreStoreSharedPreferencesImp.getInstance();
    return CoreStoreSembast._(store);
  }

  Future<void> setString(String key, String value) => _delegate.setString(key, value);

  Future<String?> getString(String key) => _delegate.getString(key);

  Future<void> setStringList(String key, List<String> value) =>
      _delegate.setStringList(key, value);

  Future<List<String>?> getStringList(String key) => _delegate.getStringList(key);

  Future<bool> remove(String key) => _delegate.remove(key);

  Future<void> clear() => _delegate.clear();
}

class CoreStoreSharedPreferences implements CoreStore {
  CoreStoreSharedPreferences._(this._delegate);

  final CoreStore _delegate;

  static Future<CoreStoreSharedPreferences> getInstance(
      {String? fileName}) async {
    final CoreStore store = await CoreStoreSharedPreferencesImp.getInstance();
    return CoreStoreSharedPreferences._(store);
  }

  Future<void> setString(String key, String value) => _delegate.setString(key, value);

  Future<String?> getString(String key) => _delegate.getString(key);

  Future<void> setStringList(String key, List<String> value) =>
      _delegate.setStringList(key, value);

  Future<List<String>?> getStringList(String key) => _delegate.getStringList(key);

  Future<bool> remove(String key) => _delegate.remove(key);

  Future<void> clear() => _delegate.clear();
}

class ParseLiveListWidget<T extends ParseObject> extends StatefulWidget {
  const ParseLiveListWidget(
      {super.key,
      required this.query,
      this.listLoadingElement,
      this.queryEmptyElement,
      this.duration = const Duration(milliseconds: 300),
      this.scrollPhysics,
      this.scrollController,
      this.scrollDirection = Axis.vertical,
      this.padding,
      this.primary,
      this.reverse = false,
      this.childBuilder,
      this.shrinkWrap = false,
      this.removedItemBuilder,
      this.listenOnAllSubItems,
      this.listeningIncludes,
      this.lazyLoading = true,
      this.preloadedColumns});

  final QueryBuilder<T> query;
  final Widget? listLoadingElement;
  final Widget? queryEmptyElement;
  final Duration duration;
  final ScrollPhysics? scrollPhysics;
  final ScrollController? scrollController;
  final Axis scrollDirection;
  final EdgeInsetsGeometry? padding;
  final bool? primary;
  final bool reverse;
  final ChildBuilder<T>? childBuilder;
  final bool shrinkWrap;
  final ChildBuilder<T>? removedItemBuilder;
  final bool? listenOnAllSubItems;
  final List<String>? listeningIncludes;
  final bool lazyLoading;
  final List<String>? preloadedColumns;

  static Widget defaultChildBuilder<T extends ParseObject>(
      BuildContext context, ParseLiveListElementSnapshot<T> snapshot) {
    Widget output;
    if (!snapshot.hasData) {
      output = const Center(child: CircularProgressIndicator());
    } else {
      output = ListTile(
        title: Text(snapshot.loadedData.toString()),
        subtitle: Text('objectId: ${snapshot.loadedData!.objectId}'),
      );
    }
    return flexChildrenWidget(output);
  }

  static Widget flexChildrenWidget(Widget child) {
    return SizedBox(width: double.infinity, child: child);
  }

  @override
  State<ParseLiveListWidget<T>> createState() => _ParseLiveListWidgetState<T>();
}

class _ParseLiveListWidgetState<T extends ParseObject>
    extends State<ParseLiveListWidget<T>> {
  ParseLiveList<T>? _liveList;
  StreamSubscription<ParseLiveListEvent<T>>? _subscription;
  final GlobalKey<AnimatedListState> _listKey = GlobalKey<AnimatedListState>();
  bool _noData = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ParseLiveList<T> liveList = await ParseLiveList.create<T>(
      widget.query,
      listenOnAllSubItems: widget.listenOnAllSubItems ?? false,
      listeningIncludes: widget.listeningIncludes,
      lazyLoading: widget.lazyLoading,
      preloadedColumns: widget.preloadedColumns,
    );
    if (!mounted) {
      liveList.dispose();
      return;
    }
    setState(() {
      _liveList = liveList;
      _noData = liveList.size == 0;
      _subscription = liveList.stream.listen(_onEvent);
    });
  }

  void _onEvent(ParseLiveListEvent<T> event) {
    if (!mounted) return;
    setState(() => _noData = _liveList!.size == 0);
    final AnimatedListState? list = _listKey.currentState;
    if (list == null) return;
    if (event is ParseLiveListDeleteEvent<T>) {
      list.removeItem(
        event.index,
        (BuildContext context, Animation<double> animation) {
          return ParseLiveListElementWidget<T>(
            key: ValueKey<String>('removing-${event.object.objectId}'),
            sizeFactor: animation,
            duration: widget.duration,
            loadedData: () => event.object,
            childBuilder: widget.removedItemBuilder ??
                widget.childBuilder ??
                ParseLiveListWidget.defaultChildBuilder<T>,
          );
        },
        duration: widget.duration,
      );
    } else if (event is ParseLiveListAddEvent<T>) {
      list.insertItem(event.index, duration: widget.duration);
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _liveList?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ParseLiveList<T>? liveList = _liveList;
    if (liveList == null) {
      return widget.listLoadingElement ?? Container();
    }
    return Stack(
      alignment: AlignmentDirectional.center,
      children: <Widget>[
        AnimatedOpacity(
          duration: widget.duration,
          opacity: _noData ? 1 : 0,
          child: widget.queryEmptyElement ?? Container(),
        ),
        AnimatedList(
          key: _listKey,
          reverse: widget.reverse,
          shrinkWrap: widget.shrinkWrap,
          padding: widget.padding,
          primary: widget.primary,
          scrollDirection: widget.scrollDirection,
          physics: widget.scrollPhysics,
          controller: widget.scrollController,
          initialItemCount: liveList.size,
          itemBuilder: (
            BuildContext context,
            int index,
            Animation<double> animation,
          ) {
            return ParseLiveListElementWidget<T>(
              key: ValueKey<String>(liveList.getIdentifier(index)),
              stream: () => liveList.getAt(index),
              loadedData: () => liveList.getLoadedAt(index),
              preLoadedData: () => liveList.getPreLoadedAt(index),
              sizeFactor: animation,
              duration: widget.duration,
              childBuilder: widget.childBuilder ??
                  ParseLiveListWidget.defaultChildBuilder<T>,
            );
          },
        ),
      ],
    );
  }
}

class ParseLiveListElementWidget<T extends ParseObject> extends StatefulWidget {
  const ParseLiveListElementWidget(
      {super.key,
      this.stream,
      this.loadedData,
      this.preLoadedData,
      required this.sizeFactor,
      required this.duration,
      required this.childBuilder});

  final StreamGetter<T>? stream;
  final DataGetter<T>? loadedData;
  final DataGetter<T>? preLoadedData;
  final Animation<double> sizeFactor;
  final Duration duration;
  final ChildBuilder<T> childBuilder;

  @override
  State<ParseLiveListElementWidget<T>> createState() =>
      _ParseLiveListElementWidgetState<T>();
}

class _ParseLiveListElementWidgetState<T extends ParseObject>
    extends State<ParseLiveListElementWidget<T>> {
  T? _loadedData;
  ParseError? _error;
  StreamSubscription<T>? _subscription;

  @override
  void initState() {
    super.initState();
    _loadedData = widget.loadedData?.call();
    if (widget.stream != null) {
      _subscription = widget.stream!().listen((T value) {
        if (mounted) setState(() => _loadedData = value);
      }, onError: (Object error) {
        if (mounted) {
          setState(() => _error = error is ParseError
              ? error
              : ParseError(message: error.toString()));
        }
      });
    }
  }

  @override
  void didUpdateWidget(covariant ParseLiveListElementWidget<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    final T? refreshed = widget.loadedData?.call();
    if (refreshed != null) _loadedData = refreshed;
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ParseLiveListElementSnapshot<T> snapshot =
        ParseLiveListElementSnapshot<T>(
      loadedData: _loadedData,
      preLoadedData: widget.preLoadedData?.call(),
      error: _error,
    );
    final Widget child = widget.childBuilder(context, snapshot);
    return SizeTransition(
      sizeFactor: widget.sizeFactor,
      child: AnimatedSize(
        duration: widget.duration,
        child: child,
      ),
    );
  }
}

class ParseLiveGridWidget<T extends ParseObject> extends StatefulWidget {
  const ParseLiveGridWidget(
      {super.key,
      required this.query,
      this.gridLoadingElement,
      this.queryEmptyElement,
      this.duration = const Duration(milliseconds: 300),
      this.scrollPhysics,
      this.scrollController,
      this.scrollDirection = Axis.vertical,
      this.padding,
      this.primary,
      this.reverse = false,
      this.childBuilder,
      this.shrinkWrap = false,
      this.removedItemBuilder,
      this.listenOnAllSubItems,
      this.listeningIncludes,
      this.lazyLoading = true,
      this.preloadedColumns,
      this.animationController,
      this.crossAxisCount = 3,
      this.crossAxisSpacing = 5.0,
      this.mainAxisSpacing = 5.0,
      this.childAspectRatio = 0.80});

  final QueryBuilder<T> query;
  final Widget? gridLoadingElement;
  final Widget? queryEmptyElement;
  final Duration duration;
  final ScrollPhysics? scrollPhysics;
  final ScrollController? scrollController;
  final Axis scrollDirection;
  final EdgeInsetsGeometry? padding;
  final bool? primary;
  final bool reverse;
  final ChildBuilder<T>? childBuilder;
  final bool shrinkWrap;
  final ChildBuilder<T>? removedItemBuilder;
  final bool? listenOnAllSubItems;
  final List<String>? listeningIncludes;
  final bool lazyLoading;
  final List<String>? preloadedColumns;
  final AnimationController? animationController;
  final int crossAxisCount;
  final double crossAxisSpacing;
  final double mainAxisSpacing;
  final double childAspectRatio;

  static Widget defaultChildBuilder<T extends ParseObject>(
      BuildContext context, ParseLiveListElementSnapshot<T> snapshot) {
    return Center(
      child: Text(snapshot.hasData
          ? '${snapshot.loadedData}'
          : 'loading ${snapshot.error}'),
    );
  }

  @override
  State<ParseLiveGridWidget<T>> createState() => _ParseLiveGridWidgetState<T>();
}

class _ParseLiveGridWidgetState<T extends ParseObject>
    extends State<ParseLiveGridWidget<T>> with TickerProviderStateMixin {
  ParseLiveList<T>? _liveList;
  StreamSubscription<ParseLiveListEvent<T>>? _subscription;
  late final AnimationController _animationController;
  bool _noData = false;

  @override
  void initState() {
    super.initState();
    _animationController =
        widget.animationController ?? AnimationController(vsync: this, duration: widget.duration);
    _load();
  }

  Future<void> _load() async {
    final ParseLiveList<T> liveList = await ParseLiveList.create<T>(
      widget.query,
      listenOnAllSubItems: widget.listenOnAllSubItems ?? false,
      listeningIncludes: widget.listeningIncludes,
      lazyLoading: widget.lazyLoading,
      preloadedColumns: widget.preloadedColumns,
    );
    if (!mounted) {
      liveList.dispose();
      return;
    }
    setState(() {
      _liveList = liveList;
      _noData = liveList.size == 0;
      _subscription = liveList.stream.listen((ParseLiveListEvent<T> event) {
        if (!mounted) return;
        setState(() {
          _noData = _liveList!.size == 0;
          _animationController.duration = widget.duration;
          _animationController.forward(from: 0);
        });
      });
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _liveList?.dispose();
    if (widget.animationController == null) _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ParseLiveList<T>? liveList = _liveList;
    if (liveList == null) {
      return widget.gridLoadingElement ?? Container();
    }
    final Animation<double> sizeFactor =
        CurvedAnimation(parent: _animationController, curve: Curves.easeInOut);
    return Stack(
      alignment: AlignmentDirectional.center,
      children: <Widget>[
        AnimatedOpacity(
          duration: widget.duration,
          opacity: _noData ? 1 : 0,
          child: widget.queryEmptyElement ?? Container(),
        ),
        GridView.builder(
          reverse: widget.reverse,
          shrinkWrap: widget.shrinkWrap,
          padding: widget.padding,
          primary: widget.primary,
          scrollDirection: widget.scrollDirection,
          physics: widget.scrollPhysics,
          controller: widget.scrollController,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: widget.crossAxisCount,
            crossAxisSpacing: widget.crossAxisSpacing,
            mainAxisSpacing: widget.mainAxisSpacing,
            childAspectRatio: widget.childAspectRatio,
          ),
          itemCount: liveList.size,
          itemBuilder: (BuildContext context, int index) {
            return ParseLiveListElementWidget<T>(
              key: ValueKey<String>(liveList.getIdentifier(index)),
              stream: () => liveList.getAt(index),
              loadedData: () => liveList.getLoadedAt(index),
              preLoadedData: () => liveList.getPreLoadedAt(index),
              sizeFactor: sizeFactor,
              duration: widget.duration,
              childBuilder: widget.childBuilder ??
                  ParseLiveGridWidget.defaultChildBuilder<T>,
            );
          },
        ),
      ],
    );
  }
}
